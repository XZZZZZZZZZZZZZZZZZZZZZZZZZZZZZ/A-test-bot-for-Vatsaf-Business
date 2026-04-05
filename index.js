require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tpg-super-secret-key', resave: false, saveUninitialized: true }));

// --- הגדרות סביבה ---
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

// --- חיבור למסד הנתונים ---
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ TPG CRM DB Active');
        createAdmin(); 
    })
    .catch(err => console.log('❌ DB Connection Error:', err));

// --- מודלים (Database Models) ---
const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' },
    assignedTeam: { type: String, default: 'Regular' }
});

const User = mongoose.model('User', {
    username: String,
    pass: String,
    role: String 
});

async function createAdmin() {
    const adminExists = await User.findOne({ username: 'M' });
    if (!adminExists) {
        await new User({ username: 'M', pass: '1', role: 'Admin' }).save();
        console.log("👤 Admin user 'M' created.");
    }
}

// --- פונקציות וואטסאפ (Green API) ---
async function sendWAButtons(chatId, text, buttons) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות ל-Green API");
    
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendButtons/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        buttons: buttons.map((btn, i) => ({ 
            buttonId: `btn_${i + 1}`, 
            buttonText: btn 
        }))
    };
    await axios.post(url, data).catch(e => console.log("❌ Button Error:", e.response?.data || e.message));
}

async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות ל-Green API");

    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ WA Error:", e.message));
}

// --- Webhook: הבוט שמקבל הודעות ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    
    // חילוץ חכם של הטקסט מכל סוגי ההודעות
    const text = body.messageData?.textMessageData?.textMessage || 
                 body.messageData?.extendedTextMessageData?.text ||
                 body.messageData?.interactiveMessageData?.buttonsMessageData?.title ||
                 body.messageData?.buttonsMessageData?.selectedButtonText || "";
                 
    console.log(`💬 הודעה נכנסת [${chatId}]: ${text}`);

    if (!text) return res.sendStatus(200); // התעלמות ממדיה/סטיקרים ללא טקסט

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // --- לוגיקת הבוט ---
    if (client.status === 'START' || text === "חזור") {
        await sendWAButtons(chatId, "ברוכים הבאים ל-TPG! נשמח לעמוד לשירותכם. במה נוכל לעזור היום?", ["מידע עלינו", "שיחה עם נציג"]);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "מידע עלינו") {
            await sendWAButtons(chatId, "אנחנו ב-TPG מתמחים בפיתוח בוטים, מערכות CRM ואוטומציות חכמות לעסקים.", ["שיחה עם נציג", "חזור"]);
        } else if (text === "שיחה עם נציג") {
            await sendWAMessage(chatId, "בשמחה! איך קוראים לכם?");
            client.status = 'ASK_NAME';
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
        await sendWAMessage(chatId, "תודה! הפנייה שלך הועברה לצוות שלנו. נציג יחזור אליך בהקדם האפשרי. 🚀");
    }

    await client.save();
    res.sendStatus(200);
});

// ==========================================
// --- מערכת ניהול (Dashboard) מעוצבת ---
// ==========================================

// 1. מסך התחברות
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
                body { background-color: #f0f2f5; height: 100vh; display: flex; align-items: center; justify-content: center; }
                .login-card { max-width: 400px; width: 100%; border-radius: 15px; border: none; }
                .brand-logo { font-size: 2rem; font-weight: bold; color: #0d6efd; text-align: center; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="card shadow-lg login-card p-4">
                <div class="brand-logo">TPG CRM</div>
                <h5 class="text-center text-muted mb-4">התחבר למערכת הניהול</h5>
                <form action="/login" method="post">
                    <div class="mb-3">
                        <label class="form-label">שם משתמש</label>
                        <input type="text" name="u" class="form-control" placeholder="הקלד שם משתמש..." required>
                    </div>
                    <div class="mb-4">
                        <label class="form-label">סיסמה</label>
                        <input type="password" name="p" class="form-control" placeholder="הקלד סיסמה..." required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100 py-2 fw-bold">היכנס למערכת</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// 2. תהליך התחברות
app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send(`
            <html lang="he" dir="rtl">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <body class="d-flex align-items-center justify-content-center bg-light" style="height:100vh;">
                <div class="text-center">
                    <h3 class="text-danger mb-3">פרטים שגויים!</h3>
                    <a href="/dashboard" class="btn btn-outline-dark">חזור ונסה שוב</a>
                </div>
            </body>
            </html>
        `);
    }
});

// 3. מסך הדשבורד הראשי
app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    // סינון: מנהל רואה הכל, צוות מקצועי רואה רק את שלו
    let filter = { status: 'WAITING' };
    if (user.role !== 'Admin') filter.assignedTeam = user.role;
    
    const clients = await Client.find(filter);
    
    // יצירת שורות הטבלה בצורה דינמית ונקייה
    let rows = clients.map(c => `
        <tr class="align-middle">
            <td class="fw-bold text-secondary" dir="ltr">${c.chatId.replace('@c.us', '')}</td>
            <td class="fw-bold">${c.name || '<span class="text-muted">לא הוזן</span>'}</td>
            <td>${c.issue || '<span class="text-muted">לא הוזן</span>'}</td>
            <td><span class="badge bg-warning text-dark px-3 py-2">ממתין (${c.assignedTeam})</span></td>
            <td>
                <div class="input-group mb-2" dir="ltr">
                    <button class="btn btn-primary" onclick="sendMsg('${c.chatId}')">שלח 💬</button>
                    <input type="text" id="msg_${c.chatId}" class="form-control text-end" placeholder="הקלד תשובה ללקוח...">
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-warning w-50" onclick="action('${c.chatId}', 'to_pro')">העבר לצוות מקצועי ⚙️</button>
                    <button class="btn btn-sm btn-success w-50" onclick="action('${c.chatId}', 'done')">סמן כטופל ✔️</button>
                </div>
            </td>
        </tr>`).join('');

    if (rows === '') {
        rows = `<tr><td colspan="5" class="text-center py-4 text-muted">אין פניות ממתינות כרגע. עבודה טובה! 🎉</td></tr>`;
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG CRM - דשבורד מנהלים</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>
                body { background-color: #f4f6f9; }
                .navbar { background: linear-gradient(90deg, #0d6efd, #0b5ed7); }
                .table-card { border-radius: 12px; overflow: hidden; border: none; }
                .table th { background-color: #f8f9fa; color: #495057; }
            </style>
        </head>
        <body>
            <nav class="navbar navbar-dark shadow-sm py-3 mb-4">
                <div class="container-fluid px-4">
                    <span class="navbar-brand mb-0 h1 fw-bold fs-4">TPG ⚡ CRM</span>
                    <div class="d-flex align-items-center text-white">
                        <span class="me-4 fs-6">מחובר כ: <strong>${user.username}</strong> <span class="badge bg-light text-primary ms-1">${user.role}</span></span>
                        <a href="/logout" class="btn btn-sm btn-outline-light fw-bold">התנתק 🚪</a>
                    </div>
                </div>
            </nav>

            <div class="container-fluid px-4">
                <h4 class="mb-4 text-dark fw-bold">ניהול פניות נכנסות</h4>
                
                <div class="card shadow-sm table-card">
                    <div class="card-body p-0 table-responsive">
                        <table class="table table-hover mb-0">
                            <thead>
                                <tr>
                                    <th width="15%">מספר טלפון</th>
                                    <th width="15%">שם הלקוח</th>
                                    <th width="30%">מהות הפנייה</th>
                                    <th width="10%">סטטוס</th>
                                    <th width="30%">פעולות ניהול</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <script>
                async function sendMsg(chatId) {
                    const msgInput = document.getElementById('msg_'+chatId);
                    const msg = msgInput.value;
                    if (!msg) return alert('נא להקליד הודעה לפני השליחה.');
                    
                    try {
                        await fetch('/api/chat', {
                            method:'POST', 
                            headers:{'Content-Type':'application/json'}, 
                            body:JSON.stringify({chatId, msg})
                        });
                        alert('ההודעה נשלחה בהצלחה ללקוח!');
                        msgInput.value = ''; // ניקוי השדה
                    } catch(e) { alert('שגיאה בשליחת ההודעה'); }
                }
                
                async function action(chatId, type) {
                    const actionName = type === 'done' ? 'לסיים את הטיפול בפנייה?' : 'להעביר פנייה זו לצוות המקצועי?';
                    if(!confirm('האם אתה בטוח שברצונך ' + actionName)) return;
                    
                    await fetch('/api/action', {
                        method:'POST', 
                        headers:{'Content-Type':'application/json'}, 
                        body:JSON.stringify({chatId, type})
                    });
                    location.reload(); // רענון הדף כדי להעלים את השורה
                }
            </script>
        </body>
        </html>
    `);
});

// --- API פעולות (נקראות על ידי הסקריפט בדשבורד) ---
app.post('/api/chat', async (req, res) => {
    await sendWAMessage(req.body.chatId, req.body.msg);
    res.json({ success: true });
});

app.post('/api/action', async (req, res) => {
    const { chatId, type } = req.body;
    if (type === 'to_pro') await Client.updateOne({ chatId }, { assignedTeam: 'Professional' });
    if (type === 'done') await Client.updateOne({ chatId }, { status: 'START' }); // מחזיר את הלקוח להתחלה
    res.json({ success: true });
});

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/dashboard'); 
});

// --- הפעלת שרת ---
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready on port ${PORT}`));
