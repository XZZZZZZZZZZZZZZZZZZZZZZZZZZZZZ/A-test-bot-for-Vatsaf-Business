const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI).then(() => console.log('✅ CRM Connected'));

const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    issue: String,
    status: { type: String, default: 'START' }
});

// פונקציה לשליחת כפתורים - משתמשת ב-sendButtons שהיא אמינה יותר
async function sendButtons(chatId, text, buttons) {
    const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendButtons/${API_TOKEN}`;
    const data = {
        chatId: chatId,
        message: text,
        buttons: buttons.map((b, i) => ({ buttonId: String(i+1), buttonText: { displayText: b } }))
    };
    try { 
        await axios.post(url, data); 
    } catch (e) { 
        console.error("Button Error:", e.response?.data || e.message); 
    }
}

async function sendText(chatId, text) {
    const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await axios.post(url, { chatId, message: text });
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return res.sendStatus(200);

    const chatId = body.senderData.chatId;
    const text = body.messageData.textMessageData?.textMessage || 
                 body.messageData.buttonsMessageData?.selectedButtonText || "";
    
    let client = await Client.findOne({ chatId }) || new Client({ chatId });

    // תפריט ראשי
    if (client.status === 'START' || text === "חזור לתפריט") {
        await sendButtons(chatId, "שלום! הגעתם ל-TPG פיתוח בוטים ואוטומציות. 🚀", ["קצת עלינו 🏢", "מעבר לנציג 👨‍💻"]);
        client.status = 'WAITING_FOR_MENU';
    } 
    // טיפול בכפתורים
    else if (text === "קצת עלינו 🏢") {
        await sendText(chatId, "TPG מתמחה בבניית מערכות ניהול חכמות ואוטומציות בוואטסאפ לעסקים.");
        await sendButtons(chatId, "רוצים להמשיך?", ["מעבר לנציג 👨‍💻", "חזור לתפריט"]);
    }
    else if (text === "מעבר לנציג 👨‍💻" || client.status === 'WAITING_FOR_MENU' && text.includes("נציג")) {
        await sendText(chatId, "בשמחה! נציג כבר יתפנה אליכם.\nרק כדי שנוכל לעזור, איך קוראים לכם?");
        client.status = 'ASKING_NAME';
    }
    else if (client.status === 'ASKING_NAME') {
        client.name = text;
        await sendText(chatId, `נעים מאוד ${text}. אנא פרטו בקצרה את הפנייה שלכם כדי שנחבר את הצוות המתאים:`);
        client.status = 'ASKING_ISSUE';
    }
    else if (client.status === 'ASKING_ISSUE') {
        client.issue = text;
        client.status = 'WITH_REP';
        await sendText(chatId, "תודה. הפנייה הועברה לנציג, מיד נענה לכם כאן. 🙏");
        // כאן הנתונים כבר שמורים ב-MongoDB למערכת החיצונית
    }

    await client.save();
    res.sendStatus(200);
});

app.listen(process.env.PORT || 8000);
