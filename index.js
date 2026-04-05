const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;

mongoose.connect(MONGODB_URI).then(() => console.log('✅ TPG CRM DB Active'));

const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' },
    assignedTeam: { type: String, default: 'Regular' }
});

// שינוי הכתובת כאן! הוספנו 7107
async function sendWA(chatId, message) {
    const url = `https://7107.api.greenapi.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("WA Error:", e.message));
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    const text = body.messageData.textMessageData?.textMessage?.trim() || "";
                 
    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    if (client.status === 'START' || text === "0") {
        await sendWA(chatId, "שלום! הגעתם ל-TPG פיתוח בוטים ואוטומציות. 🚀\nאיך נוכל לעזור?\n\nהקש 1️⃣ - קצת עלינו 🏢\nהקש 2️⃣ - מעבר לנציג 👨‍💻");
        client.status = 'WAITING_FOR_MENU';
    } 
    else if (client.status === 'WAITING_FOR_MENU') {
        if (text === "1") {
            await sendWA(chatId, "TPG מתמחה בבניית מערכות ניהול חכמות ואוטומציות בוואטסאפ לעסקים.\n\nרוצים להמשיך?\nהקש 2️⃣ - מעבר לנציג 👨‍💻\nהקש 0️⃣ - חזור לתפריט הראשי");
        }
        else if (text === "2") {
            await sendWA(chatId, "בשמחה! נציג כבר יתפנה אליכם.\nרק כדי שנוכל לעזור, איך קוראים לכם?");
            client.status = 'ASKING_NAME';
        } else {
            await sendWA(chatId, "אנא בחר 1, 2 או 0 כדי לחזור לתפריט.");
        }
    }
    else if (client.status === 'ASKING_NAME') {
        client.name = text;
        await sendWA(chatId, `נעים מאוד ${text}. אנא פרטו בקצרה את הפנייה שלכם כדי שנחבר את הצוות המתאים:`);
        client.status = 'ASKING_ISSUE';
    }
    else if (client.status === 'ASKING_ISSUE') {
        client.issue = text;
        client.status = 'WAITING'; 
        await sendWA(chatId, "תודה. הפנייה הועברה לנציג, מיד נענה לכם כאן. 🙏");
    }

    await client.save();
    res.sendStatus(200);
});

app.get('/dashboard', async (req, res) => {
    const clients = await Client.find({ status: 'WAITING' });
    
    let rows = clients.map(c => `
        <tr>
            <td><b>${c.name || 'לא הוזן'}</b></td>
            <td>${c.chatId.split('@')[0]}</td>
            <td>${c.issue || 'לא הוזן'}</td>
            <td><span class="tag">${c.assignedTeam === 'Professional' ? 'צוות מקצועי 👨‍💻' : 'צוות רגיל 👤'}</span></td>
            <td>
                <button class="btn btn-pro" onclick="action('${c.chatId}', 'to_pro')">העבר למקצועי</button>
                <button class="btn btn-end" onclick="action('${c.chatId}', 'end_general')">סיום כללי</button>
                <button class="btn btn-tech" onclick="action('${c.chatId}', 'end_tech')">סיום טכני</button>
                <button class="btn btn-sale" onclick="action('${c.chatId}', 'end_sale')">סיום מכירה</button>
            </td>
        </tr>
    `).join('');

    res.send(`
        <html dir="rtl">
        <head>
            <title>TPG Dashboard</title>
            <meta charset="utf-8">
            <style>
                body { font-family: system-ui; background: #f0f2f5; padding: 20px; }
                table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                th, td { padding: 15px; border-bottom: 1px solid #eee; text-align: right; }
                th { background: #00a884; color: white; }
                .btn { padding: 8px 12px; border: none; border-radius: 4px; cursor: pointer; color: white; margin: 2px; font-weight: bold; }
                .btn-pro { background: #2196F3; } .btn-end { background: #607D8B; }
                .btn-tech { background: #FF9800; } .btn-sale { background: #4CAF50; }
                .tag { background: #e3f2fd; padding: 4px 8px; border-radius: 10px; font-size: 13px; font-weight: bold; border: 1px solid #90caf9;}
            </style>
        </head>
        <body>
            <h1>🖥️ ניהול פניות TPG</h1>
            <table>
                <tr><th>שם</th><th>טלפון</th><th>פנייה</th><th>צוות</th><th>פעולות</th></tr>
                ${rows}
            </table>
            <script>
                async function action(chatId, type) {
                    await fetch('/api/action', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ chatId, type })
                    });
                    location.reload(); 
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/api/action', async (req, res) => {
    const { chatId, type } = req.body;
    let msg = "";

    if (type === 'to_pro') {
        await Client.updateOne({ chatId }, { assignedTeam: 'Professional' });
        return res.json({ success: true });
    }

    if (type === 'end_general') msg = "הפנייה נסגרה בהצלחה. ✅ אנו זמינים לכל עניין נוסף.";
    if (type === 'end_tech') msg = "שמחנו לעזור עם הפתרון הטכני! 🛠️ המשך עבודה פורה, צוות TPG.";
    if (type === 'end_sale') msg = "תודה רבה שרכשתם אצלנו! 🤝 אנחנו מתחילים לעבוד על האוטומציה שלכם.";

    await sendWA(chatId, msg);
    await Client.updateOne({ chatId }, { status: 'START', assignedTeam: 'Regular' }); 
    res.json({ success: true });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ TPG Server is running on port ${PORT}`));
