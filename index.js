require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// --- הגדרות שרת בסיסיות ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'tpg-super-secret-key', 
    resave: false, 
    saveUninitialized: true 
}));

// משתני סביבה מה-Koyeb
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

// --- חיבור למסד הנתונים MongoDB ---
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ TPG CRM DB Active');
        createAdmin(); 
    })
    .catch(err => console.log('❌ DB Connection Error:', err));

// מודלים של מסד הנתונים
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

// יצירת משתמש מנהל ראשוני (M / 1)
async function createAdmin() {
    const adminExists = await User.findOne({ username: 'M' });
    if (!adminExists) {
        await new User({ username: 'M', pass: '1', role: 'Admin' }).save();
        console.log("👤 Admin user 'M' created.");
    }
}

// ==========================================
// --- פונקציות תקשורת עם וואטסאפ (Green API) ---
// ==========================================

// פונקציה רגילה לשליחת הודעת טקסט
async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) return;
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ שגיאת הודעה:", e.message));
}

// המעקף המנצח: פונקציה לשליחת "כפתורים" במסווה של סקר (Poll)
async function sendWAPoll(chatId, text, options) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות ל-Green API");
    
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendPoll/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        options: options.map(opt => ({ optionName: opt })), // הופך כל טקסט לאפשרות לחיצה
        multipleAnswers: false // הלקוח יכול לבחור רק אפשרות אחת (מתנהג כמו כפתור)
    };
    
    await axios.post(url, data)
        .then(() => console.log(`✅ כפתורי-סקר נשלחו ל-${chatId}`))
        .catch(e => console.log("❌ שגיאת סקר:", e.response?.data || e.message));
}

// ==========================================
// --- Webhook: הבוט שמקבל הודעות נכנסות ---
// ==========================================

app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    // מוודא שמדובר בפעולה רלוונטית
    if (body.typeWebhook !== 'incomingMessageReceived' && body.typeWebhook !== 'outgoingAPIMessageReceived') {
        return res.sendStatus(200);
    }

    const chatId = body.senderData?.chatId;
    if (!chatId) return res.sendStatus(200);

    let text = "";
    const msgData = body.messageData;

    // 1. ניסיון לחלץ טקסט רגיל
    if (msgData?.textMessageData?.textMessage) {
        text = msgData.textMessageData.textMessage;
    } 
    else if (msgData?.extendedTextMessageData?.text) {
        text = msgData.extendedTextMessageData.text;
    }
    // 2. המעקף: ניסיון לחלץ את הלחיצה של הלקוח מתוך הסקר (Poll Vote)
    else if (msgData?.pollVoteMessageData?.votedOptions && msgData.pollVoteMessageData.votedOptions.length > 0) {
        text = msgData.pollVoteMessageData.votedOptions[0].optionName; // שולף את שם האפשרות שהלקוח סימן
    }
    else if (msgData?.pollVoteMessageData?.optionNames && msgData.pollVoteMessageData.optionNames.length > 0) {
        text = msgData.pollVoteMessageData.optionNames[0]; 
    }

    text = text.trim();
    if (!text) return res.sendStatus(200);

    console.log(`💬 הלקוח (${chatId}) בחר/שלח: "${text}"`);

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // --- לוגיקת הבוט (Flow) ---
    if (client.status === 'START' || text === "חזור") {
        // שולחים את כפתורי הסקר במקום כפתורים רגילים
        await sendWAPoll(chatId, "ברוכים הבאים ל-TPG פיתוח אוטימציות ובוטים. במה נוכל לעזור?", ["מעבר", "שיחה עם נציג"]);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "מעבר") {
            await sendWAPoll(chatId, "אנחנו ב-TPG מתמחים בפיתוח בוטים, מערכות CRM ואוטומציות חכמות לעסקים.", ["שיחה עם נציג", "חזור"]);
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
        await sendWAMessage(chatId, "תודה! הפנייה הועברה לצוות שלנו. נציג יחזור אליך בהקדם. 🚀");
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
                body { background-color: #f0f2f5; height: 100vh; display: flex; align-items: center; justify-content: center; }
                .login-card { max-width: 400px; width: 100%; border-radius: 15px; border: none; }
                .brand-logo { font-size: 2rem; font-weight: bold; color: #0d6efd; text-align: center; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="card shadow-lg login-card p-4 bg-white">
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

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send("<script>alert('פרטים שגויים'); window.location='/dashboard';</script>");
    }
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    // שליפת כל הלקוחות בסטטוס המתנה
    const clients = await Client.find({ status: 'WAITING' });
    
    let rows = clients.map(c => `
        <tr class="align-middle text-center">
            <td class="fw-bold text-secondary" dir="ltr">${c.chatId.replace('@c.us', '')}</td>
            <td class="fw-bold">${c.name || '<span class="text-muted">---</span>'}</td>
            <td>${c.issue || '<span class="text-muted">---</span>'}</td>
            <td><button class="btn btn-success btn-sm w-100 fw-bold" onclick="action('${c.chatId}')">סמן כטופל ✔️</button></td>
        </tr>`).join('');

    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG CRM - דשבורד מנהלים</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>body { background-color: #f4f6f9; }</style>
        </head>
        <body class="p-4">
            <div class="container bg-white p-4 shadow-sm rounded-4">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2 class="m-0 fw-bold">ניהול פניות נכנסות</h2>
                    <a href="/logout" class="btn btn-outline-danger btn-sm fw-bold">התנתק 🚪</a>
                </div>
                <table class="table table-hover border">
                    <thead class="table-light text-center">
                        <tr><th width="20%">מספר טלפון</th><th width="20%">שם הלקוח</th><th width="40%">מהות הפנייה</th><th width="20%">פעולות</th></tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="4" class="text-center py-5 text-muted fw-bold">אין פניות ממתינות.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <script>
                async function action(chatId) {
                    if(!confirm('לסיים טיפול? הלקוח יקבל את תפריט הפתיחה שוב כשישלח הודעה.')) return;
                    await fetch('/api/action', {
                        method:'POST', 
                        headers:{'Content-Type':'application/json'}, 
                        body:JSON.stringify({chatId: chatId})
                    });
                    location.reload(); 
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/api/action', async (req, res) => {
    await Client.updateOne({ chatId: req.body.chatId }, { status: 'START' }); 
    res.json({ success: true });
});

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/dashboard'); 
});

// --- הפעלת שרת ---
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready on port ${PORT}`));
