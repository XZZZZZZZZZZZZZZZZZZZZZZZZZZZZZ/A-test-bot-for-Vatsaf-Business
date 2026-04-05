const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

// משיכת הנתונים מהמשתנים שהגדרת ב-Koyeb
const { INSTANCE_ID, API_TOKEN, MONGODB_URI } = process.env;

// חיבור למסד הנתונים
mongoose.connect(MONGODB_URI).then(() => console.log('✅ TPG CRM DB Active'));

// המבנה של הלקוח בתוך הזיכרון
const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' },
    assignedTeam: { type: String, default: 'Regular' } // Regular או Professional
});

// פונקציה לשליחת הודעת טקסט רגילה
async function sendWA(chatId, message) {
    const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message }).catch(e => console.log("WA Error:", e.message));
}

// פונקציה לשליחת כפתורים (כולל התיקון לשגיאת ה-400!)
async function sendButtons(chatId, text, buttonsArray) {
    const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendButtons/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        buttons: buttonsArray.map((btnText, index) => ({
            buttonId: String(index + 1),
            buttonText: btnText
        }))
    };
    try { 
        await axios.post(url, data); 
    } catch (e) { 
        console.error("Button Error:", e.response?.data || e.message); 
    }
}

// --- חלק 1: הבוט בוואטסאפ ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    
    // קליטת טקסט רגיל או לחיצה על כפתור
    const text = body.messageData.textMessageData?.textMessage || 
                 body.messageData.buttonsMessageData?.selectedButtonText || "";
                 
    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // תפריט ראשי
    if (client.status === 'START' || text === "חזור לתפריט") {
        await sendButtons(chatId, "שלום! הגעתם ל-TPG פיתוח בוטים ואוטומציות. 🚀\nאיך נוכל לעזור?", ["קצת עלינו 🏢", "מעבר לנציג 👨‍💻"]);
        client.status = 'WAITING_FOR_MENU';
    } 
    else if (text === "קצת עלינו 🏢") {
        await sendWA(chatId, "TPG מתמחה בבניית מערכות ניהול חכמות ואוטומציות בוואטסאפ לעסקים.");
        await sendButtons(chatId, "רוצים להמשיך?", ["מעבר לנציג 👨‍💻", "חזור לתפריט"]);
    }
    else if (text === "מעבר לנציג 👨‍💻" || (client.status === 'WAITING_FOR_MENU' && text.includes("נציג"))) {
        await sendWA(chatId, "בשמחה! נציג כבר יתפנה אליכם.\nרק כדי שנוכל לעזור, איך קוראים לכם?");
        client.status = 'ASKING_NAME';
    }
    else if (client.status === 'ASKING_NAME') {
        client.name = text;
        await sendWA(chatId, `נעים מאוד ${text}. אנא פרטו בקצרה את הפנייה שלכם כדי שנחבר את הצוות המתאים:`);
        client.status = 'ASKING_ISSUE';
    }
    else if (client.status === 'ASKING_ISSUE') {
        client.issue = text;
        client.status = 'WAITING'; // עובר להמתנה לנציג בדשבורד
        await sendWA(chatId, "תודה. הפנייה הועברה לנציג, מיד נענה לכם כאן. 🙏");
    }

    await client.save(); // שומר את כל העדכונים ב-MongoDB
    res.sendStatus(200);
});

// --- חלק 2: המערכת החיצונית (דשבורד לנציגים) ---
app.get('/dashboard', async (req, res) => {
    // מביא רק את הלקוחות שממתינים לנציג
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
                    location.reload(); // מרענן את הדף אוטומטית אחרי הלחיצה
                }
            </script>
        </body>
        </html>
    `);
});

// --- חלק 3: ה-API של הדשבורד (מה קורה כשלוחצים על כפתור?) ---
app.post('/api/action', async (req, res) => {
    const { chatId, type } = req.body;
    let msg = "";

    if (type === 'to_pro') {
        // מעביר לצוות מקצועי ומשאיר בסטטוס המתנה
        await Client.updateOne({ chatId }, { assignedTeam: 'Professional' });
        return res.json({ success: true });
    }

    if (type === 'end_general') msg = "הפנייה נסגרה בהצלחה. ✅ אנו זמינים לכל עניין נוסף.";
    if (type === 'end_tech') msg = "שמחנו לעזור עם הפתרון הטכני! 🛠️ המשך עבודה פורה, צוות TPG.";
    if (type === 'end_sale') msg = "תודה רבה שרכשתם אצלנו! 🤝 אנחנו מתחילים לעבוד על האוטומציה שלכם.";

    await sendWA(chatId, msg);
    // מאפס את הלקוח כדי שבפעם הבאה שישלח הודעה, יתחיל מהתחלה כתור רגיל
    await Client.updateOne({ chatId }, { status: 'START', assignedTeam: 'Regular' }); 
    res.json({ success: true });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ TPG Server is running on port ${PORT}`));
