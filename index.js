require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tpg-secret-123', resave: false, saveUninitialized: true }));

// --- הגדרות משתנים ---
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_URL = `https://api.green-api.com/waInstance${INSTANCE_ID}`;

// בדיקה בטרמינל אם המפתחות נטענו
console.log("--- בדיקת הגדרות ---");
console.log("INSTANCE_ID:", INSTANCE_ID ? "✅ מוגדר" : "❌ חסר!");
console.log("API_TOKEN:", API_TOKEN ? "✅ מוגדר" : "❌ חסר!");
console.log("MONGODB_URI:", MONGODB_URI ? "✅ מוגדר" : "❌ חסר!");

// --- חיבור למסד נתונים ---
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ מחובר למסד הנתונים של TPG');
        createAdmin();
    })
    .catch(err => console.error('❌ שגיאת התחברות ל-DB:', err.message));

// מודלים
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
    const admin = await User.findOne({ username: 'M' });
    if (!admin) {
        await new User({ username: 'M', pass: '1', role: 'Admin' }).save();
        console.log("👤 משתמש מנהל 'M' נוצר בהצלחה.");
    }
}

// --- פונקציות שליחה לוואטסאפ ---

// שליחת הודעה רגילה
async function sendWAMessage(chatId, message) {
    try {
        const url = `${GREEN_API_URL}/sendMessage/${API_TOKEN}`;
        await axios.post(url, { chatId, message });
        console.log(`✉️ הודעה נשלחה ל-${chatId}`);
    } catch (e) {
        console.error("❌ שגיאה בשליחת הודעה:", e.response?.data || e.message);
    }
}

// שליחת כפתורים (בפורמט החדש והנתמך)
async function sendWAButtons(chatId, text, buttons) {
    try {
        const url = `${GREEN_API_URL}/sendInteractiveMessage/${API_TOKEN}`;
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
        await axios.post(url, data);
        console.log(`🔘 כפתורים נשלחו ל-${chatId}`);
    } catch (e) {
        console.error("❌ שגיאה בשליחת כפתורים, שולח טקסט רגיל במקום...");
        // גיבוי למקרה שהכפתורים נכשלים (וואטסאפ חוסם לפעמים)
        const fallbackText = `${text}\n\nהשב במילה:\n* ${buttons.join('\n* ')}`;
        await sendWAMessage(chatId, fallbackText);
    }
}

// --- ה-WEBHOOK (הלב של הבוט) ---
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        
        // סינון הודעות שאינן הודעות נכנסות
        if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

        const chatId = body.senderData.chatId;
        const text = body.messageData.textMessageData?.textMessage || 
                     body.messageData.interactiveMessageData?.buttonsMessageData?.title || 
                     body.messageData.buttonsMessageData?.selectedButtonText || "";

        console.log(`📩 הודעה מ-${chatId}: "${text}"`);

        let client = await Client.findOne({ chatId });
        if (!client) client = new Client({ chatId });

        // לוגיקת הבוט (מכונת מצבים)
        if (client.status === 'START' || text === "חזור") {
            await sendWAButtons(chatId, "שלום! ברוכים הבאים ל-TPG. במה נוכל לעזור?", ["מידע עלינו", "שיחה עם נציג"]);
            client.status = 'MENU';
        } 
        else if (client.status === 'MENU') {
            if (text === "מידע עלינו") {
                await sendWAButtons(chatId, "אנחנו מפתחים פתרונות AI ואוטומציות מתקדמות.", ["שיחה עם נציג", "חזור"]);
            } else if (text === "שיחה עם נציג") {
                await sendWAMessage(chatId, "בשמחה. מה השם שלכם?");
                client.status = 'ASK_NAME';
            }
        }
        else if (client.status === 'ASK_NAME') {
            client.name = text;
            await sendWAMessage(chatId, `נעים מאוד ${text}, מה מהות הפנייה שלך?`);
            client.status = 'ASK_ISSUE';
        }
        else if (client.status === 'ASK_ISSUE') {
            client.issue = text;
            client.status = 'WAITING';
            await sendWAMessage(chatId, "תודה. פנייתך הועברה לנציג, נחזור אליך בהקדם.");
        }

        await client.save();
        res.sendStatus(200);
    } catch (err) {
        console.error("⚠️ שגיאה ב-Webhook:", err.message);
        res.sendStatus(500);
    }
});

// --- דשבורד ניהול ---
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.send(`
            <html dir="rtl"><body style="font-family:sans-serif; text-align:center; padding:50px;">
            <h2>כניסה למערכת TPG</h2>
            <form action="/login" method="post">
                <input name="u" placeholder="שם משתמש"><br><br>
                <input name="p" type="password" placeholder="סיסמה"><br><br>
                <button type="submit">התחבר</button>
            </form>
            </body></html>`);
    }
    res.redirect('/admin');
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send('פרטים שגויים. <a href="/dashboard">נסה שוב</a>');
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
            <td>${c.name || 'לא ידוע'}</td>
            <td>${c.issue || 'ללא פירוט'}</td>
            <td>
                <input type="text" id="msg_${c.chatId}" placeholder="תשובה לנציג...">
                <button onclick="sendMsg('${c.chatId}')">שלח</button>
                <button onclick="action('${c.chatId}', 'to_pro')" style="background:orange">למקצועי</button>
                <button onclick="action('${c.chatId}', 'done')" style="background:green; color:white">סיים</button>
            </td>
        </tr>`).join('');

    res.send(`
        <html dir="rtl"><head><meta charset="utf-8"><title>TPG Admin</title>
        <style>body{font-family:sans-serif; background:#f0f2f5; padding:20px;} table{width:100%; border-collapse:collapse; background:white;} td,th{padding:12px; border:1px solid #ddd; text-align:right;}</style>
        </head><body>
            <h2>שלום ${user.username} | <a href="/logout">התנתק</a></h2>
            <h3>פניות ממתינות לטיפול:</h3>
            <table><tr><th>שם הלקוח</th><th>תיאור התקלה</th><th>פעולות</th></tr>${rows}</table>
            <script>
                async function sendMsg(chatId) {
                    const msg = document.getElementById('msg_'+chatId).value;
                    if(!msg) return alert('נא להזין הודעה');
                    await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, msg})});
                    alert('הודעה נשלחה לוואטסאפ!');
                }
                async function action(chatId, type) {
                    await fetch('/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, type})});
                    location.reload();
                }
            </script>
        </body></html>`);
});

// API לפעולות מהדשבורד
app.post('/api/c
