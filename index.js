require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tpg-super-secret-key', resave: false, saveUninitialized: true }));

const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_HOST = 'https://api.green-api.com'; 

mongoose.connect(MONGODB_URI).then(() => {
    console.log('✅ TPG CRM DB Active');
    createAdmin(); 
}).catch(err => console.log('❌ DB Error:', err));

const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' }
});

const User = mongoose.model('User', { username: String, pass: String });

async function createAdmin() {
    if (!(await User.findOne({ username: 'M' }))) {
        await new User({ username: 'M', pass: '1' }).save();
    }
}

// --- פונקציית כפתורים (Interactive Message - הסטנדרט העדכני) ---
async function sendWAButtons(chatId, text, buttons) {
    if (!INSTANCE_ID || !API_TOKEN) return;
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendInteractiveMessage/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: {
            type: "buttonsMessage",
            buttonsMessage: {
                contentText: text,
                footerText: "TPG פיתוח בוטים",
                buttons: buttons.map((btn, i) => ({
                    type: "replyButton",
                    title: btn,
                    id: `btn_${i + 1}`
                }))
            }
        }
    };
    await axios.post(url, data).catch(e => console.log("❌ Button Error:", e.response?.data || e.message));
}

async function sendWAMessage(chatId, message) {
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ Error:", e.message));
}

// --- קבלת הודעות ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    const text = (body.messageData?.textMessageData?.textMessage || 
                 body.messageData?.extendedTextMessageData?.text || 
                 body.messageData?.interactiveMessageData?.buttonsMessageData?.title ||
                 body.messageData?.buttonsMessageData?.selectedButtonText || "").trim();
                 
    console.log(`💬 הודעה מ-${chatId}: ${text}`);
    if (!text) return res.sendStatus(200);

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    if (client.status === 'START' || text === "חזור") {
        await sendWAButtons(chatId, "ברוכים הבאים ל-TPG פיתוח אוטימציות ובוטים", ["מעבר", "שיחה עם נציג"]);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "מעבר") {
            await sendWAButtons(chatId, "אנחנו ב-TPG מתמחים בפיתוח בוטים ומערכות חכמות.", ["שיחה עם נציג", "חזור"]);
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
        await sendWAMessage(chatId, "תודה! הפנייה הועברה לצוות. נציג יחזור אליך בהקדם. 🚀");
    }

    await client.save();
    res.sendStatus(200);
});

// --- Dashboard ---
app.get('/dashboard', (req, res) => {
    res.send(`<html dir="rtl"><body style="background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
    <div style="background:white;padding:30px;border-radius:15px;box-shadow:0 10px 20px rgba(0,0,0,0.1);text-align:center;width:350px;">
    <h2 style="color:#0d6efd">TPG CRM</h2><br>
    <form action="/login" method="post">
    <input name="u" placeholder="משתמש" style="width:100%;padding:10px;margin-bottom:10px;"><br>
    <input name="p" type="password" placeholder="סיסמה" style="width:100%;padding:10px;margin-bottom:20px;"><br>
    <button style="width:100%;padding:10px;background:#0d6efd;color:white;border:none;border-radius:5px;cursor:pointer;">כניסה</button>
    </form></div></body></html>`);
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) { req.session.user = user; res.redirect('/admin'); }
    else { res.send("פרטים שגויים"); }
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const clients = await Client.find({ status: 'WAITING' });
    let rows = clients.map(c => `<tr style="text-align:center;"><td>${c.chatId.split('@')[0]}</td><td>${c.name}</td><td>${c.issue}</td>
    <td><button onclick="action('${c.chatId}')">סיים טיפול</button></td></tr>`).join('');
    res.send(`<html dir="rtl"><body style="font-family:sans-serif;padding:20px;"><h2>פניות ממתינות</h2>
    <table border="1" style="width:100%;border-collapse:collapse;">
    <tr style="background:#eee;"><th>טלפון</th><th>שם</th><th>פנייה</th><th>פעולה</th></tr>${rows}</table>
    <script>async function action(id){ await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:id})}); location.reload(); }</script>
    </body></html>`);
});

app.post('/api/action', async (req, res) => {
    await Client.updateOne({ chatId: req.body.chatId }, { status: 'START' });
    res.json({ success: true });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready`));
