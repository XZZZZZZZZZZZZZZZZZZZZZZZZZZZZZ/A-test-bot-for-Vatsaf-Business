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

// משתני סביבה מ-Koyeb
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
});

const User = mongoose.model('User', {
    username: String,
    pass: String
});

// יצירת משתמש מנהל ראשוני
async function createAdmin() {
    const adminExists = await User.findOne({ username: 'M' });
    if (!adminExists) {
        await new User({ username: 'M', pass: '1' }).save();
        console.log("👤 Admin user 'M' created.");
    }
}

// --- פונקציית שליחת הודעת טקסט רגילה ---
async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) return;
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ שגיאת הודעה:", e.message));
}

// ==========================================
// --- Webhook: הבוט שמקבל הודעות נכנסות ---
// ==========================================

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData?.chatId;
    if (!chatId) return res.sendStatus(200);

    // חילוץ הטקסט שהלקוח הקליד
    let text = (body.messageData?.textMessageData?.textMessage || 
                body.messageData?.extendedTextMessageData?.text || "").trim();

    if (!text) return res.sendStatus(200);

    console.log(`💬 הלקוח (${chatId}) שלח: "${text}"`);

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // --- לוגיקת הבוט (תפריט ממוספר ואמין) ---
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
    }

    await client.save();
    res.sendStatus(200);
});

// ==========================================
// --- מערכת ניהול (Dashboard) מעוצבת ---
// ==========================================

// מסך התחברות
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
                body { background-color: #f0f2f5; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
                .login-card { max-width: 400px; width: 100%; border-radius: 15px; border: none; }
                .brand-logo { font-size: 2.2rem; font-weight: 900; color: #0d6efd; text-align: center; margin-bottom: 20px; letter-spacing: 1px;}
            </style>
        </head>
        <body>
            <div class="card shadow-lg login-card p-4 bg-white">
                <div class="brand-logo">TPG CRM</div>
                <h5 class="text-center text-muted mb-4">התחבר למערכת הניהול</h5>
                <form action="/login" method="post">
                    <div class="mb-3">
                        <label class="form-label fw-bold">שם משתמש</label>
                        <input type="text" name="u" class="form-control" placeholder="הקלד שם משתמש..." required>
                    </div>
                    <div class="mb-4">
                        <label class="form-label fw-bold">סיסמה</label>
                        <input type="password" name="p" class="form-control" placeholder="הקלד סיסמה..." required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100 py-2 fw-bold fs-5 shadow-sm">היכנס למערכת</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// תהליך כניסה
app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send("<script>alert('פרטים שגויים'); window.location='/dashboard';</script>");
    }
});

// מסך הניהול הראשי (טבלת פניות)
app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    // שליפת רק הלקוחות שצריכים טיפול
    const clients = await Client.find({ status: 'WAITING' });
    
    let rows = clients.map(c => `
        <tr class="align-middle text-center">
            <td class="fw-bold text-secondary" dir="ltr">${c.chatId.replace('@c.us', '')}</td>
            <td class="fw-bold">${c.name || '<span class="text-muted">---</span>'}</td>
            <td>${c.issue || '<span class="text-muted">---</span>'}</td>
            <td>
                <span class="badge bg-warning text-dark px-3 py-2 mb-2 d-block w-100">ממתין לטיפול</span>
                <button class="btn btn-success btn-sm w-100 fw-bold shadow-sm" onclick="action('${c.chatId}')">סמן כטופל ✔️</button>
            </td>
        </tr>`).join('');

    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TPG CRM - דשבורד מנהלים</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>
                body { background-color: #f4f6f9; font-family: system-ui, -apple-system, sans-serif; }
                .table-container { border-radius: 12px; overflow: hidden; }
                .table th { background-color: #f8f9fa; }
            </style>
        </head>
        <body class="p-2 p-md-4">
            <div class="container bg-white p-4 shadow-sm rounded-4 border">
                <div class="d-flex justify-content-between align-items-center mb-4 border-bottom pb-3">
                    <div>
                        <h2 class="m-0 fw-bold text-primary">TPG מערכות ניהול</h2>
                        <span class="text-muted small">מחובר כ: <strong>${user.username}</strong></span>
                    </div>
                    <a href="/logout" class="btn btn-outline-danger btn-sm fw-bold px-3">התנתק 🚪</a>
                </div>
                
                <h4 class="mb-3 fw-bold text-dark">פניות נכנסות:</h4>
                <div class="table-responsive table-container border">
                    <table class="table table-hover mb-0">
                        <thead class="table-light text-center">
                            <tr>
                                <th width="20%">מספר טלפון</th>
                                <th width="20%">שם הלקוח</th>
                                <th width="40%">מהות הפנייה</th>
                                <th width="20%">פעולות טיפול</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || '<tr><td colspan="4" class="text-center py-5 text-muted fw-bold fs-5">אין פניות ממתינות כרגע. אפשר לשתות קפה ☕</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <script>
                async function action(chatId) {
                    if(!confirm('סיימת לטפל בלקוח? הסטטוס שלו יאופס והבוט יתחיל מחדש בשיחה הבאה.')) return;
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

// פקודת API לסיום טיפול בלקוח
app.post('/api/action', async (req, res) => {
    await Client.updateOne({ chatId: req.body.chatId }, { status: 'START' }); 
    res.json({ success: true });
});

// התנתקות
app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/dashboard'); 
});

// --- הפעלת שרת ---
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready on port ${PORT}`));
