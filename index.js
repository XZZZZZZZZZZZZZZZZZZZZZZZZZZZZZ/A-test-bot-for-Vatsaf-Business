const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(() => console.log('✅ TPG Database Connected'));

// מבנה הלקוח ב-CRM (כולל צוות וסטטוס)
const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' }, // START, ASKING_NAME, ASKING_ISSUE, WITH_REP
    assignedTeam: { type: String, default: 'Regular' } // Regular, Professional, Sales
});

async function api(method, data) {
    const url = `https://7107.api.green-api.com/waInstance${INSTANCE_ID}/${method}/${API_TOKEN}`;
    return axios.post(url, data).catch(e => console.error(`API Error (${method}):`, e.message));
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    const text = body.messageData.textMessageData?.textMessage || "";
    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // לוגיקה של הבוט לפי מצב הלקוח
    if (client.status === 'START') {
        await api('sendTemplateMessage', {
            chatId,
            templateMessage: {
                content: { text: "שלום! הגעתם ל-TPG פיתוח בוטים ואוטומציות. 🚀\nנשמח לעמוד לשירותכם." },
                buttons: [
                    { index: 1, quickReplyButton: { displayText: "קצת עלינו 🏢", id: "about" } },
                    { index: 2, quickReplyButton: { displayText: "מעבר לנציג 👨‍💻", id: "rep" } }
                ]
            }
        });
        client.status = 'WAITING_FOR_CLICK';
    } 
    else if (text.includes("מעבר לנציג")) {
        await api('sendMessage', { chatId, message: "בשמחה! לפני שנחבר נציג, איך קוראים לך?" });
        client.status = 'ASKING_NAME';
    }
    else if (client.status === 'ASKING_NAME') {
        client.name = text;
        await api('sendMessage', { chatId, message: `נעים מאוד ${text}. נציג כבר יתפנה אליכם, אנא פרטו בקצרה את הפנייה שלכם:` });
        client.status = 'ASKING_ISSUE';
    }
    else if (client.status === 'ASKING_ISSUE') {
        client.issue = text;
        client.status = 'WITH_REP';
        await api('sendMessage', { chatId, message: "תודה על הפירוט. הפנייה הועברה לנציג, מיד נענה." });
        // כאן הבוט יכול לשלוח התראה למנהל/צוות
    }
    // פקודות סגירה (לשימוש הנציג או הבוט)
    else if (text === "סיום פניה") {
        await api('sendMessage', { chatId, message: "הפנייה נסגרה בהצלחה. ✅\nאנו נשארים זמינים עבורכם לכל עניין נוסף. פשוט שלחו הודעה חדשה ונחזור אליכם." });
        client.status = 'START';
    }
    else if (text === "סיום פניה טכני") {
        await api('sendMessage', { chatId, message: "שמחנו לעזור לכם עם הפתרון הטכני! 🛠️\nהמשך עבודה פורה, צוות TPG." });
        client.status = 'START';
    }
    else if (text === "סיום מכירה") {
        await api('sendMessage', { chatId, message: "תודה רבה שרכשתם אצלנו! 🤝\nאנחנו כבר מתחילים לעבוד על האוטומציה שלכם. פרטים נוספים יישלחו בקרוב." });
        client.status = 'START';
    }

    await client.save();
    res.sendStatus(200);
});

app.listen(process.env.PORT || 8000);
