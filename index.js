require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tpg-secret', resave: false, saveUninitialized: true }));

// משתני הסביבה 
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;

// חיבור למסד הנתונים
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

// יצירת מנהל מערכת במידה ולא קיים
async function createAdmin() {
    const adminExists = await User.findOne({ username: 'M' });
    if (!adminExists) {
        await new User({ username: 'M', pass: '1', role: 'Admin' }).save();
        console.log("👤 Admin user 'M' created.");
    }
}

// כתובת הבסיס של שרתי Green API
const GREEN_API_HOST = 'https://api.green-api.com'; 

// שליחת כפתורים (Interactive Message החדש)
async function sendWAButtons(chatId, text, buttons) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות ל-Green API");
    
    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendInteractiveMessage/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: {
            type: "buttonsMessage",
            buttonsMessage: {
                contentText: text,
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

// שליחת הודעת טקסט רגילה
async function sendWAMessage(chatId, message) {
    if (!INSTANCE_ID || !API_TOKEN) return console.log("⚠️ חסרים נתוני התחברות ל-Green API");

    const url = `${GREEN_API_HOST}/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("❌ WA Error:", e.message));
}

// --- הבוט בוואטסאפ (Webhook) ---
app.post('/webhook', async (req, res) => {
    console.log("🔔 הודעה חדשה התקבלה מה-Webhook!");
    
    const body = req.body;
    
    // סינון הודעות שאינן הודעות נכנסות
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    // השורה שתדפיס את ה-JSON השלם בדיוק כפי שהתקבל כדי שנוכל לאתר את הטקסט
    console.log("📦 המידע הגולמי המלא:", JSON.stringify(body, null, 2));

    const chatId = body.senderData.chatId;
    
    const text = body.messageData?.textMessageData?.textMessage || 
                 body.messageData?.extendedTextMessageData?.text ||
                 body.messageData?.interactiveMessageData?.buttonsMessageData?.title ||
                 body.messageData?.buttonsMessageData?.selectedButtonText || "";
                 
    console.log(`📝 תוכן ההודעה מ-${chatId}: "${text}"`);

    // הגנה קטנה למקרה של חוסר טקסט
    if (!text) {
        console.log("⚠️ התקבלה הודעה ללא טקסט (ממתין לפענוח המבנה הגולמי).");
        return res.sendStatus(200);
    }

    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // הלוגיקה של הבוט
    if (client.status === 'START' || text === "חזור") {
        await sendWAButtons(chatId, "ברוכים הבאים ל-TPG! במה נוכל לעזור?", ["מידע עלינו", "שיחה עם נציג"]);
        client.status = 'MENU';
    } 
    else if (client.status === 'MENU') {
        if (text === "מידע עלינו") {
            await sendWAButtons(chatId, "אנחנו מפתחים בוטים ואוטומציות חכמות.", ["שיחה עם נציג", "חזור"]);
        } else if (text === "שיחה עם נציג") {
            await sendWAMessage(chatId, "בשמחה. איך קוראים לכם?");
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
        await sendWAMessage(chatId, "תודה, נציג יחזור אליך בהקדם. בינתיים, המערכת ממתינה.");
    }

    await client.save();
    res.sendStatus(200);
});

// --- דשבורד ומערכת כניסה ---
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.send('<form action="/login" method="post" dir="rtl" style="font-family:sans-serif; text-align:center; margin-top:50px;">שם משתמש: <input name="u"><br><br>סיסמה: <input name="p" type="password"><br><br><button>כניסה</button></form>');
    res.redirect('/admin');
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send('<div dir="rtl" style="font-family:sans-serif; text-align:center; margin-top:50px;">פרטים שגויים. <a href="/dashboard">נסה שוב</a></div>');
    }
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const user = req.session.user;
    
    let filter = { status: 'WAITING' };
    if (user.role !== 'Admin') filter.assignedTeam = user.role;
    
    const clients = await Client.find(filter);
    
    let rows = clients.map(c => `
        <tr>
            <td>${c.name || 'לא הוזן'}</td>
            <td>${c.issue || 'לא הוזן'}</td>
            <td>
                <input type="text" id="msg_${c.chatId}" placeholder="הקלידו תשובה...">
                <button onclick="sendMsg('${c.chatId}')">שלח הודעה</button>
                <button onclick="action('${c.chatId}', 'to_pro')">העבר למקצועי</button>
                <button onclick="action('${c.chatId}', 'done')">סיים טיפול</button>
            </td>
        </tr>`).join('');

    res.send(`
        <html dir="rtl"><head><meta charset="utf-8"><title>TPG CRM</title>
        <style>body{font-family:sans-serif; background:#f4f4f4; padding:20px;} table{width:100%; background:white; border-collapse:collapse;} td,th{padding:10px; border:1px solid #ddd;} input{padding:5px;} button{padding:5px 10px; cursor:pointer;} </style>
        </head><body>
            <h2>שלום ${user.username} (${user.role}) | <a href="/logout">התנתק</a></h2>
            <table><tr><th>שם</th><th>פנייה</th><th>פעולות</th></tr>${rows}</table>
            <script>
                async function sendMsg(chatId) {
                    const msg = document.getElementById('msg_'+chatId).value;
                    if (!msg) return alert('נא להקליד הודעה תחילה');
                    await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, msg})});
                    alert('הודעה נשלחה!');
                }
                async function action(chatId, type) {
                    await fetch('/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, type})});
                    location.reload();
                }
            </script>
        </body></html>`);
});

app.post('/api/chat', async (req, res) => {
    await sendWAMessage(req.body.chatId, req.body.msg);
    res.json({ success: true });
});

app.post('/api/action', async (req, res) => {
    const { chatId, type } = req.body;
    if (type === 'to_pro') await Client.updateOne({ chatId }, { assignedTeam: 'Professional' });
    if (type === 'done') await Client.updateOne({ chatId }, { status: 'START' });
    res.json({ success: true });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/dashboard'); });

// הפעלת השרת
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready on port ${PORT}`));
