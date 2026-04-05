require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// הגדרות בסיסיות של השרת
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'tpg-super-secret-key', 
    resave: false, 
    saveUninitialized: true 
}));

// משיכת משתני סביבה מ-Koyeb
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

// חיבור למסד הנתונים MongoDB
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

// --- פונקציות תקשורת עם וואטסאפ (Green API) ---

async function sendWAButtons(chatId, text, buttons) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות");
    
    // שימוש בנתיב sendButtons שהוא הכי יציב למניעת 404
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendButtons/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        buttons: buttons.map((btn, i) => ({ 
            buttonId: `btn_${i + 1}`, 
            buttonText: btn 
        }))
    };
    
    await axios.post(url, data)
        .then(() => console.log(`✅ כפתורים נשלחו ל-${chatId}`))
        .catch(e => {
            console.log("❌ שגיאת כפתורים:", e.response?.status, e.response?.data || e.message);
        });
}

async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) return;
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ שגיאת הודעה:", e.message));
}

// --- Webhook: קבלת הודעות נכנסות ---

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    
    // שליפת טקסט מכל סוגי ההודעות האפשריים
    const text = body.messageData?.textMessageData?.textMessage || 
                 body.messageData?.extendedTextMessageData?.text ||
                 body.messageData?.interactiveMessageData?.buttonsMessageData?.title ||
                 body.messageData?.buttonsMessageData?.selectedButtonText || 
                 body.messageData?.buttonsMessageData?.buttonText || "";
                 
    console.log(`💬 הודעה מ-${chatId}: "${text}"`);
    if (!text) return res.sendStatus(200);

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // לוגיקת הבוט (זרימה)
    if (client.status === 'START' || text === "חזור") {
        await sendWAButtons(chatId, "ברוכים הבאים ל-TPG פיתוח אוטימציות ובוטים", ["מעבר", "שיחה עם נציג"]);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "מעבר") {
            await sendWAButtons(chatId, "אנחנו ב-TPG מתמחים בפיתוח בוטים, מערכות CRM ואוטומציות חכמות לעסקים.", ["שיחה עם נציג", "חזור"]);
        } else if (text === "שיחה עם נציג") {
            await sendWAMessage(chatId, "בשמחה! איך קוראים לכם?");
            client.status = 'ASK_NAME';
        }
    }
    else if (client.status === 'ASK_NAME') {
        client.name = text;
        await sendWAMessage(chatId, `נעים מאוד ${text}, מה מהות הפנייה?`);
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

// --- מערכת ניהול (Dashboard) ---

app.get('/dashboard', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.send(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>TPG CRM - כניסה</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <style>
                body { background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
                .card { width: 380px; border-radius: 15px; border: none; padding: 30px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
            </style>
        </head>
        <body>
            <div class="card bg-white text-center">
                <h2 class="text-primary fw-bold mb-4">TPG CRM</h2>
                <form action="/login" method="post">
                    <input type="text" name="u" class="form-control mb-3" placeholder="שם משתמש" required>
                    <input type="password" name="p" class="form-control mb-4" placeholder="סיסמה" required>
                    <button class="btn btn-primary w-100 py-2 fw-bold">התחבר למערכת</button>
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
    const clients = await Client.find({ status: 'WAITING' });
    
    let rows = clients.map(c => `
        <tr class="align-middle">
            <td dir="ltr" class="fw-bold text-secondary">${c.chatId.split('@')[0]}</td>
            <td>${c.name || '---'}</td>
            <td>${c.issue || '---'}</td>
            <td><button class="btn btn-success btn-sm px-3" onclick="action('${c.chatId}')">סיים טיפול</button></td>
        </tr>`).join('');

    res.send(`
        <html lang="he" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
            <title>TPG - ניהול פניות</title>
        </head>
        <body class="bg-light p-5">
            <div class="container bg-white p-4 shadow-sm rounded-4">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2 class="m-0 fw-bold">ניהול פניות נכנסות</h2>
                    <a href="/logout" class="btn btn-outline-danger btn-sm">התנתק</a>
                </div>
                <table class="table table-hover">
                    <thead class="table-light"><tr><th>מספר טלפון</th><th>שם הלקוח</th><th>מהות הפנייה</th><th>פעולות</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="4" class="text-center py-5 text-muted">אין פניות ממתינות. עבודה טובה! 🎉</td></tr>'}</tbody>
                </table>
            </div>
            <script>
                async function action(chatId) {
                    if(!confirm('לסיים טיפול ולשלוח את הבוט להתחלה?')) return;
                    await fetch('/api/action', {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({chatId})
                    });
                    location.reload();
                }
            </script>
        </body></html>
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

// הפעלת השרת בפורט 8000 (מותאם ל-Koyeb)
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System running on port ${PORT}`));
