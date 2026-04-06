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

// משתני סביבה מ-Koyeb
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

// --- חיבור למסד הנתונים MongoDB ---
mongoose.connect(MONGODB_URI || 'mongodb://localhost:27017/tpg_crm')
    .then(() => {
        console.log('✅ TPG CRM DB Active');
        createAdmin(); 
    })
    .catch(err => console.log('❌ DB Connection Error:', err));

// מודלים של מסד הנתונים
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

// יצירת משתמש מנהל (או עדכון ההרשאות שלו למנהל אם הוא כבר קיים)
async function createAdmin() {
    // הפונקציה הזו מוצאת את M, מעדכנת אותו למנהל, ואם הוא לא קיים - יוצרת אותו מאפס
    await User.findOneAndUpdate(
        { username: 'M' }, 
        { pass: '1', role: 'admin', isProfessional: true },
        { upsert: true, new: true }
    );
    
    // יצירת נציג בדיקות (רק אם לא קיים)
    const agentExists = await User.findOne({ username: 'Agent1' });
    if (!agentExists) {
        await new User({ username: 'Agent1', pass: '1', role: 'agent', isProfessional: false }).save(); 
    }
    
    console.log("👤 Admin user 'M' role is verified as ADMIN.");
}

// --- פונקציית שליחת הודעת טקסט לוואטסאפ ---
async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) {
        console.log(`[Mock WA Send to ${chatId}]: ${message}`);
        return;
    }
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ שגיאת הודעה:", e.message));
}

// ==========================================
// --- מערכת נוכחות וסוקטים (זמן אמת) ---
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
            { 
                $push: { messages: { sender: agentName, text } },
                $set: { status: 'IN_CHAT' } 
            },
            { new: true }
        );
        
        io.emit('chat_updated', { chatId, message: { sender: agentName, text, timestamp: new Date() } });
    });

    socket.on('close_ticket', async (chatId) => {
        await Client.updateOne({ chatId }, { status: 'START' });
        await sendWAMessage(chatId, "הפנייה נסגרה על ידי הנציג. לעזרה נוספת, שלחו הודעה חדשה ויפתח מענה אוטומטי.");
        io.emit('ticket_closed', chatId);
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
// --- Webhook: הבוט שמקבל הודעות נכנסות ---
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData?.chatId;
    if (!chatId) return res.sendStatus(200);

    let text = (body.messageData?.textMessageData?.textMessage || 
                body.messageData?.extendedTextMessageData?.text || "").trim();

    if (!text) return res.sendStatus(200);
    console.log(`💬 הלקוח (${chatId}) שלח: "${text}"`);

    let client = await Client.findOne({ chatId });
    if (!client) {
        client = new Client({ chatId });
    }

    client.messages.push({ sender: 'customer', text });

    // אם הלקוח כרגע בשיחה עם נציג או ממתין, מעבירים ישירות לדשבורד ולא מקפיצים בוט
    if (client.status === 'WAITING' || client.status === 'IN_CHAT') {
        await client.save();
        io.emit('chat_updated', { chatId, message: { sender: 'customer', text, timestamp: new Date() } });
        return res.sendStatus(200);
    }

    // --- לוגיקת הבוט האוטומטית ---
    if (client.status === 'START' || text === "חזור") {
        const menuText = 
            `*ברוכים הבאים ל-TPG פיתוח אוטימציות ובוטים* 🤖\n\n` +
            `אנא בחרו אחת מהאפשרויות הבאות (השיבו עם מספר):\n\n` +
            `*1️⃣* - מידע על המערכות שלנו\n` +
            `*2️⃣* - שיחה עם נציג אנושי`;
        
        await sendWAMessage(chatId, menuText);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "1") {
            await sendWAMessage(chatId, "אנחנו ב-TPG מתמחים בפיתוח בוטים, מערכות CRM ואוטומציות חכמות לעסקים.\n\nלמעבר לשיחה עם נציג הקישו *2*.\nלחזרה לתפריט הראשי שלחו *חזור*.");
        } else if (text === "2") {
            await sendWAMessage(chatId, "בשמחה! איך קוראים לכם?");
            client.status = 'ASK_NAME';
        } else {
            await sendWAMessage(chatId, "אנא בחרו אפשרות תקינה (1 או 2). לחזרה שלחו *חזור*.");
        }
    }
    else if (client.status === 'ASK_NAME') {
        client.name = text;
        await sendWAMessage(chatId, `נעים מאוד ${text}, מה מהות הפנייה? (בכמה מילים)`);
        client.status = 'ASK_ISSUE';
    }
    else if (client.status === 'ASK_ISSUE') {
        client.issue = text;
        client.status = 'WAITING';
        await sendWAMessage(chatId, "תודה! הפנייה הועברה לצוות שלנו. נציג יחזור אליך בהקדם. 🚀");
        io.emit('new_ticket', client);
    }

    await client.save();
    res.sendStatus(200);
});

// ==========================================
// --- מערכת ניהול (Dashboard) מעוצבת ---
// ==========================================

app.get('/dashboard', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    
    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG CRM - התחברות</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>
                body { background-color: #f0f2f5; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
                .login-card { max-width: 400px; width: 100%; border-radius: 15px; border: none; }
                .brand-logo { font-size: 2.2rem; font-weight: 900; color: #0d6efd; text-align: center; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="card shadow-lg login-card p-4 bg-white">
                <div class="brand-logo">TPG CRM</div>
                <h5 class="text-center text-muted mb-4">התחבר למערכת הניהול</h5>
                <form action="/login" method="post">
                    <div class="mb-3">
                        <label class="form-label fw-bold">שם משתמש</label>
                        <input type="text" name="u" class="form-control" required>
                    </div>
                    <div class="mb-4">
                        <label class="form-label fw-bold">סיסמה</label>
                        <input type="password" name="p" class="form-control" required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100 py-2 fw-bold fs-5 shadow-sm">היכנס למערכת</button>
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
    } else {
        res.send("<script>alert('פרטים שגויים'); window.location='/dashboard';</script>");
    }
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    const clients = await Client.find({ status: { $in: ['WAITING', 'IN_CHAT'] } });

    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG CRM - Workspace</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <script src="/socket.io/socket.io.js"></script>
            <style>
                body { background-color: #f4f6f9; font-family: system-ui, sans-serif; overflow-x: hidden; }
                .chat-box { height: 400px; overflow-y: auto; background: #e5ddd5; border-radius: 8px; padding: 15px; }
                .msg { max-width: 75%; padding: 8px 12px; border-radius: 8px; margin-bottom: 10px; clear: both; }
                .msg.customer { background: #fff; float: right; border-top-right-radius: 0; }
                .msg.agent { background: #dcf8c6; float: left; border-top-left-radius: 0; text-align: left; }
                .ticket-item { cursor: pointer; transition: 0.2s; }
                .ticket-item:hover { background-color: #f8f9fa; }
            </style>
        </head>
        <body class="p-3">
            <div class="container-fluid">
                <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                    <h3 class="m-0 fw-bold text-primary">TPG Workspace <span class="badge bg-secondary fs-6">${user.role === 'admin' ? 'מנהל' : 'נציג'}</span></h3>
                    <a href="/logout" class="btn btn-outline-danger btn-sm fw-bold">התנתק 🚪</a>
                </div>

                <div class="row">
                    <div class="col-md-3 border-end">
                        <h5 class="fw-bold">פניות פעילות</h5>
                        <ul class="list-group" id="tickets-list">
                            ${clients.map(c => `
                                <li class="list-group-item ticket-item" onclick="openChat('${c.chatId}', '${c.name || 'לקוח'}')">
                                    <strong>${c.name || c.chatId.replace('@c.us','')}</strong><br>
                                    <small class="text-muted">${c.issue}</small>
                                </li>
                            `).join('')}
                        </ul>
                    </div>

                    <div class="col-md-6">
                        <h5 class="fw-bold" id="chat-header">בחר פנייה כדי להתחיל</h5>
                        <div class="chat-box border mb-2" id="chat-box"></div>
                        <div class="input-group">
                            <input type="text" id="chat-input" class="form-control" placeholder="הקלד הודעה..." disabled>
                            <button class="btn btn-primary" id="btn-send" disabled onclick="sendMessage()">שלח</button>
                            <button class="btn btn-success" id="btn-close" disabled onclick="closeTicket()">סיום טיפול ✔️</button>
                        </div>
                    </div>

                    <div class="col-md-3 border-start ${user.role !== 'admin' ? 'd-none' : ''}">
                        <h5 class="fw-bold">צוות מחובר בזמן אמת</h5>
                        <ul class="list-group" id="online-users-list"></ul>
                    </div>
                </div>
            </div>

            <script>
                const currentUser = { username: '${user.username}', role: '${user.role}' };
                const socket = io();
                
                let activeChatId = null;

                socket.on('connect', () => {
                    socket.emit('login', currentUser);
                });

                function openChat(chatId, name) {
                    activeChatId = chatId;
                    document.getElementById('chat-header').innerText = "בשיחה עם: " + name;
                    document.getElementById('chat-input').disabled = false;
                    document.getElementById('btn-send').disabled = false;
                    document.getElementById('btn-close').disabled = false;
                    document.getElementById('chat-box').innerHTML = '<div class="text-center text-muted mt-5">התחלת שיחה בזמן אמת (חיבור סוקט פעיל)</div>';
                }

                function sendMessage() {
                    const input = document.getElementById('chat-input');
                    if(!input.value.trim() || !activeChatId) return;
                    
                    socket.emit('agent_send_message', {
                        chatId: activeChatId,
                        text: input.value.trim(),
                        agentName: currentUser.username
                    });
                    input.value = '';
                }

                function closeTicket() {
                    if(confirm("לסגור פנייה זו? הלקוח יחזור לסטטוס בוט אוטומטי בהודעה הבאה.")) {
                        socket.emit('close_ticket', activeChatId);
                        location.reload();
                    }
                }

                socket.on('chat_updated', (data) => {
                    if(data.chatId === activeChatId) {
                        const chatBox = document.getElementById('chat-box');
                        const isAgent = data.message.sender !== 'customer';
                        chatBox.innerHTML += \`<div class="msg \${isAgent ? 'agent' : 'customer'}">
                            <strong>\${isAgent ? 'אני' : 'לקוח'}:</strong> \${data.message.text}
                        </div>\`;
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                });

                socket.on('ticket_closed', (chatId) => {
                    if(chatId === activeChatId) {
                        alert("הפנייה נסגרה בהצלחה.");
                        location.reload();
                    }
                });

                socket.on('new_ticket', () => location.reload()); 

                socket.on('presence_updated', (users) => {
                    if(currentUser.role !== 'admin') return;
                    const list = document.getElementById('online-users-list');
                    list.innerHTML = users.map(u => \`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            \${u.username}
                            \${u.username !== currentUser.username ? \`<button class="btn btn-sm btn-danger" onclick="kickUser('\${u.socketId}')">נתק משתמש</button>\` : ''}
                        </li>
                    \`).join('');
                });

                function kickUser(socketId) {
                    if(confirm("לנתק משתמש זה בכוח?")) {
                        socket.emit('force_logout', socketId);
                    }
                }

                socket.on('kicked_out', (reason) => {
                    alert(reason);
                    window.location.href = '/logout';
                });

            </script>
        </body>
        </html>
    `);
});

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/dashboard'); 
});

// --- הפעלת שרת משולב ---
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`🚀 TPG System (Bot + Realtime CRM) ready on port ${PORT}`));
