const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session'); // בשביל מערכת הכניסה
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tpg-secret', resave: false, saveUninitialized: true }));

const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;

mongoose.connect(MONGODB_URI).then(() => console.log('✅ TPG CRM DB Active'));

// מודלים של מסד הנתונים
const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' },
    assignedTeam: { type: String, default: 'Regular' } // Regular / Professional
});

const User = mongoose.model('User', {
    username: String,
    pass: String,
    role: String // Admin / Regular / Professional
});

// יצירת מנהל מערכת ראשוני אם לא קיים
async function createAdmin() {
    const adminExists = await User.findOne({ username: 'M' });
    if (!adminExists) {
        await new User({ username: 'M', pass: '1', role: 'Admin' }).save();
        console.log("👤 Admin user 'M' created.");
    }
}
createAdmin();

// --- פונקציות שליחה (חזרה לכפתורים!) ---
async function sendWAButtons(chatId, text, buttons) {
    const url = `https://7107.api.greenapi.com/waInstance${INSTANCE_ID}/sendButtons/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        buttons: buttons.map((btn, i) => ({ buttonId: String(i + 1), buttonText: btn }))
    };
    await axios.post(url, data).catch(e => console.log("Button Error:", e.message));
}

async function sendWAMessage(chatId, message) {
    const url = `https://7107.api.greenapi.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("WA Error:", e.message));
}

// --- הבוט בוואטסאפ ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    const text = body.messageData.textMessageData?.textMessage || 
                 body.messageData.buttonsMessageData?.selectedButtonText || "";
                 
    let client = await Client.findOne({ chatId }) || new Client({ chatId });

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
        await sendWAMessage(chatId, "תודה, נציג יחזור אליך בהקדם.");
    }

    await client.save();
    res.sendStatus(200);
});

// --- דשבורד ומערכת כניסה ---
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.send('<form action="/login" method="post">שם: <input name="u"><br>סיסמה: <input name="p" type="password"><br><button>כניסה</button></form>');
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
    
    // סינון פניות: מנהל רואה הכל, צוות רואה רק את שלו
    let filter = { status: 'WAITING' };
    if (user.role !== 'Admin') filter.assignedTeam = user.role;
    
    const clients = await Client.find(filter);
    
    let rows = clients.map(c => `
        <tr>
            <td>${c.name}</td>
            <td>${c.issue}</td>
            <td>
                <input type="text" id="msg_${c.chatId}" placeholder="הקלידו תשובה...">
                <button onclick="sendMsg('${c.chatId}')">שלח הודעה</button>
                <button onclick="action('${c.chatId}', 'to_pro')">העבר למקצועי</button>
                <button onclick="action('${c.chatId}', 'done')">סיים טיפול</button>
            </td>
        </tr>`).join('');

    res.send(`
        <html dir="rtl"><head><meta charset="utf-8"><title>TPG CRM</title>
        <style>body{font-family:sans-serif; background:#f4f4f4; padding:20px;} table{width:100%; background:white; border-collapse:collapse;} td,th{padding:10px; border:1px solid #ddd;}</style>
        </head><body>
            <h2>שלום ${user.username} (${user.role}) | <a href="/logout">התנתק</a></h2>
            <table><tr><th>שם</th><th>פנייה</th><th>פעולות</th></tr>${rows}</table>
            <script>
                async function sendMsg(chatId) {
                    const msg = document.getElementById('msg_'+chatId).value;
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

// API לפעולות מהדשבורד
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

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG System ready on port ${PORT}`));
