require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
const server = http.createServer(app); 
const io = new Server(server, { cors: { origin: '*' } }); 

// --- הגדרות שרת בסיסיות ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'tpg-super-secret-key', 
    resave: false, 
    saveUninitialized: true 
}));

const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

// --- חיבור למסד הנתונים MongoDB ---
mongoose.connect(MONGODB_URI || 'mongodb://localhost:27017/tpg_crm')
    .then(() => {
        console.log('✅ TPG CRM DB Active');
        createAdmin(); 
    })
    .catch(err => console.log('❌ DB Connection Error:', err));

// --- סכמות (Schemas) במסד הנתונים ---
const ClientSchema = new mongoose.Schema({
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' }, 
    messages: [{ sender: String, text: String, timestamp: { type: Date, default: Date.now } }] 
});
const Client = mongoose.model('Client', ClientSchema);

const UserSchema = new mongoose.Schema({
    username: String,
    pass: String,
    role: { type: String, default: 'agent' }, 
    isProfessional: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

async function createAdmin() {
    await User.findOneAndUpdate(
        { username: 'M' }, 
        { pass: '1', role: 'admin', isProfessional: true },
        { upsert: true, new: true }
    );
}

async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) {
        console.log(`[Mock WA Send to ${chatId}]: ${message}`);
        return;
    }
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ שגיאת הודעה:", e.message));
}

// ==========================================
// --- מערכת נוכחות וסוקטים (CRM) ---
// ==========================================
const onlineUsers = new Map(); 

io.on('connection', (socket) => {
    socket.on('login', (userData) => {
        onlineUsers.set(socket.id, { ...userData, socketId: socket.id, loginTime: new Date() });
        io.emit('presence_updated', Array.from(onlineUsers.values()));
    });

    socket.on('agent_send_message', async (data) => {
        const { chatId, text, agentName } = data;
        await sendWAMessage(chatId, text);
        await Client.findOneAndUpdate(
            { chatId },
            { $push: { messages: { sender: agentName, text } }, $set: { status: 'IN_CHAT' } },
            { new: true }
        );
        io.emit('chat_updated', { chatId, message: { sender: agentName, text, timestamp: new Date() } });
    });

    socket.on('action_ticket', async (data) => {
        const { chatId, action } = data;
        if (action === 'close') {
            await Client.updateOne({ chatId }, { status: 'START' });
            await sendWAMessage(chatId, "הפנייה נסגרה בהצלחה. לעזרה נוספת, פשוט שלחו לנו הודעה חדשה! שיהיה המשך יום מקסים ✨");
        } 
        else if (action === 'sale') {
            await Client.updateOne({ chatId }, { status: 'START' });
            await sendWAMessage(chatId, "תודה רבה שבחרתם ב-TPG! שמחנו להעניק לכם שירות, ונשמח לראותכם שוב בעתיד. 🚀🎉");
        }
        else if (action === 'transfer_pro') {
            await Client.updateOne({ chatId }, { status: 'WAITING_PRO' });
            await sendWAMessage(chatId, "פנייתך חשובה לנו והועברה כעת לצוות המומחים שלנו. נציג בכיר יעבור על הנתונים ויתפנה אליך בהקדם האפשרי. 🧑‍🔧⏳");
        }
        io.emit('ticket_closed', chatId); 
    });

    socket.on('toggle_professional', async (data) => {
        const { username, isProfessional } = data;
        await User.updateOne({ username }, { isProfessional });
    });

    socket.on('force_logout', (socketIdToKick) => {
        io.to(socketIdToKick).emit('kicked_out', 'נותקת על ידי מנהל המערכת.');
        io.sockets.sockets.get(socketIdToKick)?.disconnect(true);
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('presence_updated', Array.from(onlineUsers.values()));
    });
});

// ==========================================
// --- Webhook: הבוט של וואטסאפ (הזרימה המקורית של TPG) ---
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    // --- לוגים לדיבוג ---
    console.log("--- Webhook Triggered ---");
    console.log("Type:", body.typeWebhook);

    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData?.chatId;
    if (!chatId) return res.sendStatus(200);

    let text = (body.messageData?.textMessageData?.textMessage || body.messageData?.extendedTextMessageData?.text || "").trim();
    console.log(`📩 Message from ${chatId}: ${text}`);

    if (!text) return res.sendStatus(200);

    let client = await Client.findOne({ chatId }) || new Client({ chatId });
    client.messages.push({ sender: 'customer', text });

    // אם הלקוח כבר בטיפול של נציג ב-CRM, רק מעדכנים הודעות ולא מפעילים בוט
    if (client.status === 'WAITING' || client.status === 'WAITING_PRO' || client.status === 'IN_CHAT') {
        console.log("Client in active chat, skipping bot flow.");
        await client.save();
        io.emit('chat_updated', { chatId, message: { sender: 'customer', text, timestamp: new Date() } });
        return res.sendStatus(200);
    }

    if (client.status === 'START' || text === "חזור") {
        const msg = `*ברוכים הבאים ל-TPG - המומחים לאוטומציות ובוטים!* 🚀🤖\n\nאיך נוכל לעזור היום? (אנא השב/י עם מספר):\n\n*1️⃣* ℹ️ מידע על המערכות שלנו\n*2️⃣* 🗣️ שיחה עם נציג אנושי`;
        await sendWAMessage(chatId, msg);
        client.status = 'MENU';
    } else if (client.status === 'MENU') {
        if (text === "1") {
            await sendWAMessage(chatId, "אנחנו ב-TPG מתמחים בבניית בוטים חכמים, מערכות CRM ואוטומציות שמייעלות את העסק שלך! 💡📈\n\nלמעבר לשיחה עם נציג הקישו *2*.\nלחזרה לתפריט הראשי שלחו *חזור* 🔙.");
        }
        else if (text === "2") { 
            await sendWAMessage(chatId, "בשמחה רבה! 😊 איך קוראים לך כדי שנוכל לתת שירות אישי?"); 
            client.status = 'ASK_NAME'; 
        }
        else {
            await sendWAMessage(chatId, "אופס, לא הבנתי את הבחירה 😅\nאנא בחר/י *1* או *2* מהתפריט. לחזרה, אפשר פשוט לכתוב *חזור*.");
        }
    } else if (client.status === 'ASK_NAME') {
        client.name = text;
        await sendWAMessage(chatId, `נעים מאוד ${text}! 👋 כדי שנוכל לעזור בצורה הטובה ביותר, מה מהות הפנייה שלך אלינו היום? (בכמה מילים ✍️)`);
        client.status = 'ASK_ISSUE';
    } else if (client.status === 'ASK_ISSUE') {
        client.issue = text;
        client.status = 'WAITING';
        await sendWAMessage(chatId, "תודה רבה! 🙏 הפנייה נרשמה והועברה לצוות המומחים שלנו. נציג יחזור אליך ממש בקרוב. בינתיים, שיהיה המשך יום מצוין! 🌟");
        io.emit('new_ticket', client);
    }

    await client.save();
    console.log("Client flow saved successfully.");
    res.sendStatus(200);
});

// ==========================================
// --- ה-API של ה-CRM ---
// ==========================================
app.post('/api/add_user', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/admin');
    const { new_username, new_pass, new_role } = req.body;
    const exists = await User.findOne({ username: new_username });
    if (!exists && new_username && new_pass) {
        let role = 'agent', isPro = false;
        if (new_role === 'admin') { role = 'admin'; isPro = true; }
        else if (new_role === 'pro') { role = 'agent'; isPro = true; }
        await new User({ username: new_username, pass: new_pass, role: role, isProfessional: isPro }).save();
    }
    res.redirect('/admin');
});

app.get('/api/chat/:chatId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const client = await Client.findOne({ chatId: req.params.chatId });
    if (!client) return res.json({ messages: [], name: '', issue: '' });
    res.json({ messages: client.messages, name: client.name, issue: client.issue });
});

// ==========================================
// --- מערכת ניהול (Dashboard) ---
// ==========================================
app.get('/dashboard', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8"><title>TPG - התחברות</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>body{background:#f0f2f5;height:100vh;display:flex;align-items:center;justify-content:center;}</style>
        </head>
        <body>
            <div class="card p-4 shadow bg-white" style="width:100%; max-width:400px; border-radius:15px;">
                <h3 class="text-center text-primary fw-bold mb-4">TPG CRM</h3>
                <form action="/login" method="post">
                    <input type="text" name="u" class="form-control mb-3" placeholder="שם משתמש" required>
                    <input type="password" name="p" class="form-control mb-4" placeholder="סיסמה" required>
                    <button type="submit" class="btn btn-primary w-100 fw-bold">התחבר</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = { username: user.username, role: user.role, isProfessional: user.isProfessional };
        res.redirect('/admin');
    } else res.send("<script>alert('פרטים שגויים'); window.location='/dashboard';</script>");
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    let allowedStatuses = ['WAITING', 'IN_CHAT'];
    if (user.isProfessional || user.role === 'admin') allowedStatuses.push('WAITING_PRO');
    
    const clients = await Client.find({ status: { $in: allowedStatuses } });
    const allUsers = user.role === 'admin' ? await User.find({}) : [];

    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG Workspace</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <script src="/socket.io/socket.io.js"></script>
            <style>
                body { background-color: #f4f6f9; font-family: system-ui, sans-serif; overflow-x: hidden; }
                .chat-box { height: 450px; overflow-y: auto; background: #e5ddd5; border-radius: 8px; padding: 15px; }
                .msg { max-width: 75%; padding: 8px 12px; border-radius: 8px; margin-bottom: 10px; clear: both; }
                .msg.customer { background: #fff; float: right; border-top-right-radius: 0; }
                .msg.agent { background: #dcf8c6; float: left; border-top-left-radius: 0; text-align: left; }
                .nav-link { cursor: pointer; }
                .bot-summary { background-color: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px; padding: 10px; margin-bottom: 15px; text-align: right; clear: both;}
                .ticket-item { cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; border-radius: 12px; border: 1px solid #e0e0e0; }
                .ticket-item:hover { transform: translateY(-3px); box-shadow: 0 .5rem 1rem rgba(0,0,0,.1)!important; border-color: #0d6efd; }
                .ticket-pro { background-color: #fff3cd !important; border-color: #ffc107 !important; }
            </style>
        </head>
        <body>
            <nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm mb-4">
                <div class="container-fluid">
                    <span class="navbar-brand fw-bold">TPG CRM</span>
                    <div class="collapse navbar-collapse" id="navbarNav">
                        <ul class="navbar-nav me-auto">
                            <li class="nav-item"><a class="nav-link active fw-bold" id="nav-workspace" onclick="switchTab('workspace')">דף הבית</a></li>
                            \${user.role === 'admin' ? \`<li class="nav-item"><a class="nav-link fw-bold" id="nav-users" onclick="switchTab('users')">ניהול משתמשים</a></li>\` : ''}
                        </ul>
                        <span class="navbar-text text-white me-4">
                            מחובר/ת: <strong>\${user.username}</strong> <span class="badge bg-light text-dark ms-1">\${user.role === 'admin' ? 'מנהל' : (user.isProfessional ? 'צוות מקצועי' : 'נציג רגיל')}</span>
                        </span>
                        <a href="/logout" class="btn btn-danger btn-sm fw-bold shadow-sm">התנתק 🚪</a>
                    </div>
                </div>
            </nav>

            <div class="container-fluid px-4" id="page-workspace">
                <div class="row">
                    <div class="col-md-4 col-lg-3 border-end">
                        <h5 class="fw-bold mb-3">פניות פעילות</h5>
                        <div id="tickets-list" class="d-flex flex-column gap-3 pb-3">
                            \${clients.length === 0 ? '<div class="text-muted text-center mt-3">אין פניות כרגע</div>' : ''}
                            \${clients.map(c => \`
                                <div class="card ticket-item shadow-sm bg-white \${c.status === 'WAITING_PRO' ? 'ticket-pro' : ''}" onclick="openChat('\${c.chatId}', '\${c.name || 'לקוח'}')">
                                    <div class="card-body p-3">
                                        <h6 class="fw-bold mb-1 text-primary">\${c.name || c.chatId.replace('@c.us','')} \${c.status === 'WAITING_PRO' ? '⭐' : ''}</h6>
                                        <p class="text-muted mb-0 small text-truncate" style="max-height: 2.5em; overflow: hidden;">\${c.issue || 'ללא פירוט'}</p>
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                    </div>

                    <div class="col-md-8 col-lg-9">
                        <h5 class="fw-bold" id="chat-header">בחר פנייה כדי להתחיל בשיחה</h5>
                        <div class="chat-box border mb-3 shadow-sm" id="chat-box">
                            <div class="text-center text-muted mt-5">התחל בבחירת לקוח מהרשימה...</div>
                        </div>
                        <div class="input-group shadow-sm mb-3">
                            <input type="text" id="chat-input" class="form-control" placeholder="הקלד הודעה..." disabled>
                            <button class="btn btn-primary px-4 fw-bold" id="btn-send" disabled onclick="sendMessage()">שלח</button>
                        </div>
                        
                        <div class="d-flex gap-2">
                            <button class="btn btn-warning flex-fill fw-bold shadow-sm" id="btn-transfer" disabled onclick="actionTicket('transfer_pro')">🧑‍🔧 העבר לצוות מקצועי</button>
                            <button class="btn btn-success flex-fill fw-bold shadow-sm" id="btn-sale" disabled onclick="actionTicket('sale')">💰 סיום מכירה</button>
                            <button class="btn btn-secondary flex-fill fw-bold shadow-sm" id="btn-close" disabled onclick="actionTicket('close')">✔️ סיום פנייה</button>
                        </div>
                    </div>
                </div>
            </div>

            \${user.role === 'admin' ? \`
            <div class="container-fluid px-4 d-none" id="page-users">
                <div class="row">
                    <div class="col-md-8 border-end pe-4">
                        <h4 class="fw-bold text-dark mb-4">⚙️ ניהול משתמשים במערכת</h4>
                        <div class="card p-4 mb-4 shadow-sm border-0 bg-light">
                            <h6 class="fw-bold text-primary mb-3">➕ הוספת משתמש חדש</h6>
                            <form action="/api/add_user" method="POST" class="row g-2 align-items-center">
                                <div class="col-md-3"><input type="text" name="new_username" class="form-control" placeholder="שם משתמש" required></div>
                                <div class="col-md-3"><input type="text" name="new_pass" class="form-control" placeholder="סיסמה" required></div>
                                <div class="col-md-3">
                                    <select name="new_role" class="form-select">
                                        <option value="agent">נציג רגיל</option><option value="pro">צוות מקצועי</option><option value="admin">מנהל</option>
                                    </select>
                                </div>
                                <div class="col-md-3"><button type="submit" class="btn btn-success w-100 fw-bold">צור משתמש</button></div>
                            </form>
                        </div>

                        <h6 class="fw-bold mb-3">רשימת משתמשים קיימים:</h6>
                        <div class="table-responsive shadow-sm rounded">
                            <table class="table table-hover table-bordered mb-0 bg-white">
                                <thead class="table-light text-center"><tr><th>שם משתמש</th><th>הרשאה</th><th>פעולות מהירות</th></tr></thead>
                                <tbody>
                                    \${allUsers.map(u => \`
                                        <tr class="align-middle text-center">
                                            <td class="fw-bold">\${u.username}</td>
                                            <td>\${u.role === 'admin' ? '👑 מנהל' : (u.isProfessional ? '⭐ צוות מקצועי' : '🎧 נציג רגיל')}</td>
                                            <td>
                                                \${u.role !== 'admin' ? \`<button class="btn btn-sm \${u.isProfessional ? 'btn-danger' : 'btn-primary'}" onclick="togglePro('\${u.username}', \${!u.isProfessional})">\${u.isProfessional ? 'הסר מצוות מקצועי' : 'הגדר כצוות מקצועי'}</button>\` : '<span class="text-muted small">מנהל ראשי</span>'}
                                            </td>
                                        </tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="col-md-4 ps-4">
                        <h5 class="fw-bold mb-3">🟢 משתמשים מחוברים כעת</h5>
                        <ul class="list-group shadow-sm" id="online-users-list"></ul>
                    </div>
                </div>
            </div>
            \` : ''}

            <script>
                const currentUser = { username: '\${user.username}', role: '\${user.role}' };
                const socket = io();
                let activeChatId = null;

                socket.on('connect', () => { socket.emit('login', currentUser); });

                function switchTab(tabName) {
                    document.getElementById('page-workspace').classList.add('d-none');
                    if (document.getElementById('page-users')) document.getElementById('page-users').classList.add('d-none');
                    document.getElementById('nav-workspace').classList.remove('active');
                    if (document.getElementById('nav-users')) document.getElementById('nav-users').classList.remove('active');
                    document.getElementById('page-' + tabName).classList.remove('d-none');
                    document.getElementById('nav-' + tabName).classList.add('active');
                }

                async function openChat(chatId, name) {
                    activeChatId = chatId;
                    document.getElementById('chat-header').innerText = "בשיחה עם: " + name;
                    document.getElementById('chat-input').disabled = false;
                    document.getElementById('btn-send').disabled = false;
                    document.getElementById('btn-transfer').disabled = false;
                    document.getElementById('btn-sale').disabled = false;
                    document.getElementById('btn-close').disabled = false;
                    
                    const chatBox = document.getElementById('chat-box');
                    chatBox.innerHTML = '<div class="text-center text-muted mt-5">טוען היסטוריית שיחה...</div>';

                    try {
                        const res = await fetch('/api/chat/' + chatId);
                        const data = await res.json();
                        let html = '';
                        if (data.name || data.issue) {
                            html += \`<div class="bot-summary shadow-sm">
                                <strong>🤖 נתונים מהבוט:</strong><br>
                                <span class="text-muted">שם:</span> \${data.name || 'לא צוין'}<br>
                                <span class="text-muted">פנייה:</span> \${data.issue || 'לא צוין'}
                            </div>\`;
                        }
                        data.messages.forEach(msg => {
                            const isAgent = msg.sender !== 'customer';
                            const senderName = isAgent ? msg.sender : 'לקוח';
                            html += \`<div class="msg \${isAgent ? 'agent' : 'customer'} shadow-sm">
                                <strong>\${senderName}:</strong> \${msg.text}
                            </div>\`;
                        });
                        chatBox.innerHTML = html || '<div class="text-center text-muted mt-5">אין היסטוריית הודעות.</div>';
                        chatBox.scrollTop = chatBox.scrollHeight;
                    } catch(err) {
                        chatBox.innerHTML = '<div class="text-center text-danger mt-5">שגיאה בטעינת היסטוריה.</div>';
                    }
                }

                function sendMessage() {
                    const input = document.getElementById('chat-input');
                    if(!input.value.trim() || !activeChatId) return;
                    socket.emit('agent_send_message', { chatId: activeChatId, text: input.value.trim(), agentName: currentUser.username });
                    input.value = '';
                }

                function actionTicket(actionType) {
                    let msg = "";
                    if(actionType === 'close') msg = "לסגור פנייה זו?";
                    if(actionType === 'sale') msg = "לסגור את הפנייה כהצלחה במכירה (ישלח הודעת תודה)?";
                    if(actionType === 'transfer_pro') msg = "להעביר פנייה זו לטיפול של צוות מקצועי?";
                    if(confirm(msg)) {
                        socket.emit('action_ticket', { chatId: activeChatId, action: actionType });
                        setTimeout(() => location.reload(), 300);
                    }
                }

                function togglePro(username, makePro) {
                    if(confirm("לשנות הגדרות צוות מקצועי לנציג זה?")) {
                        socket.emit('toggle_professional', { username, isProfessional: makePro });
                        setTimeout(() => location.reload(), 300);
                    }
                }

                socket.on('chat_updated', (data) => {
                    if(data.chatId === activeChatId) {
                        const chatBox = document.getElementById('chat-box');
                        const isAgent = data.message.sender !== 'customer';
                        chatBox.innerHTML += \`<div class="msg \${isAgent ? 'agent' : 'customer'} shadow-sm">
                            <strong>\${isAgent ? 'אני' : 'לקוח'}:</strong> \${data.message.text}
                        </div>\`;
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                });

                socket.on('ticket_closed', () => location.reload());
                socket.on('new_ticket', () => location.reload()); 

                socket.on('presence_updated', (users) => {
                    if(currentUser.role !== 'admin') return;
                    const list = document.getElementById('online-users-list');
                    if (list) {
                        list.innerHTML = users.map(u => \`
                            <li class="list-group-item d-flex justify-content-between align-items-center">
                                <div><strong>\${u.username}</strong><br><small class="text-muted">\${u.role === 'admin' ? 'מנהל' : 'נציג'}</small></div>
                                \${u.username !== currentUser.username ? \`<button class="btn btn-sm btn-outline-danger" onclick="kickUser('\${u.socketId}')">נתק</button>\` : '<span class="badge bg-success">אתה</span>'}
                            </li>
                        \`).join('');
                    }
                });

                function kickUser(socketId) {
                    if(confirm("לנתק משתמש זה מהמערכת בכוח?")) socket.emit('force_logout', socketId);
                }

                socket.on('kicked_out', (reason) => {
                    alert(reason); window.location.href = '/logout';
                });
            </script>
        </body>
        </html>
    `);
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/dashboard'); });

// --- הפעלת שרת ---
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`🚀 TPG System (CRM Only) ready on port \${PORT}`));
