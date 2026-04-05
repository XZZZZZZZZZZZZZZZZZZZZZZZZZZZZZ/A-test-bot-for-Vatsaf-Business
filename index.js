require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'tpg-secret-key-123', 
    resave: false, 
    saveUninitialized: true 
}));

const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;
const GREEN_API_URL = `https://api.green-api.com/waInstance${INSTANCE_ID}`;

// חיבור למסד הנתונים
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ TPG CRM DB Active');
        createAdmin();
    })
    .catch(err => console.error('❌ DB Error:', err.message));

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
        console.log("👤 Admin 'M' created");
    }
}

// פונקציות שליחה
async function sendWAMessage(chatId, message) {
    try {
        await axios.post(`${GREEN_API_URL}/sendMessage/${API_TOKEN}`, { chatId, message });
    } catch (e) {
        console.error("WA Error:", e.message);
    }
}

async function sendWAButtons(chatId, text, buttons) {
    try {
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
        await axios.post(`${GREEN_API_URL}/sendInteractiveMessage/${API_TOKEN}`, data);
    } catch (e) {
        const fallback = `${text}\n\nהשב במילה:\n* ${buttons.join('\n* ')}`;
        await sendWAMessage(chatId, fallback);
    }
}

// WEBHOOK
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

        const chatId = body.senderData.chatId;
        const text = body.messageData.textMessageData?.textMessage || 
                     body.messageData.interactiveMessageData?.buttonsMessageData?.title || "";

        let client = await Client.findOne({ chatId }) || new Client({ chatId });

        if (client.status === 'START' || text === "חזור") {
            await sendWAButtons(chatId, "ברוכים הבאים ל-TPG! במה נוכל לעזור?", ["מידע עלינו", "שיחה עם נציג"]);
            client.status = 'MENU';
        } 
        else if (client.status === 'MENU') {
            if (text === "מידע עלינו") {
                await sendWAButtons(chatId, "אנחנו מפתחים בוטים ואוטומציות.", ["שיחה עם נציג", "חזור"]);
            } else if (text === "שיחה עם נציג") {
                await sendWAMessage(chatId, "בשמחה. מה השם שלכם?");
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
    } catch (err) {
        res.sendStatus(200); 
    }
});

// דשבורד
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.send('<html dir="rtl"><form action="/login" method="post">שם: <input name="u"><br>סיסמה: <input name="p" type="password"><br><button>כניסה</button></form></html>');
    res.redirect('/admin');
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.u, pass: req.body.p });
    if (user) {
        req.session.user = user;
        res.redirect('/admin');
    } else {
        res.send('טעות. <a href="/dashboard">שוב</a>');
    }
});

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/dashboard');
    const clients = await Client.find({ status: 'WAITING' });
    
    let rows = clients.map(c => `
        <tr>
            <td>${c.name}</td>
            <td>${c.issue}</td>
            <td>
                <input type="text" id="msg_${c.chatId}">
                <button onclick="sendMsg('${c.chatId}')">שלח</button>
                <button onclick="action('${c.chatId}', 'done')">סיים</button>
            </td>
        </tr>`).join('');

    res.send(`<html dir="rtl"><body><h2>ניהול פניות</h2><table>${rows}</table>
    <script>
        async function sendMsg(chatId) {
            const msg = document.getElementById('msg_'+chatId).value;
            await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, msg})});
            alert('נשלח');
        }
        async function action(chatId, type) {
            await fetch('/api/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chatId, type})});
            location.reload();
        }
    </script></body></html>`);
});

// פונקציות API לסיום הקוד
app.post('/api/chat', async (req, res) => {
    await sendWAMessage(req.body.chatId, req.body.msg);
    res.json({ success: true });
});

app.post('/api/action', async (req, res) => {
    const { chatId, type } = req.body;
    if (type === 'done') await Client.updateOne({ chatId }, { status: 'START' });
    res.json({ success: true });
});

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/dashboard'); 
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 TPG Active on port ${PORT}`));
