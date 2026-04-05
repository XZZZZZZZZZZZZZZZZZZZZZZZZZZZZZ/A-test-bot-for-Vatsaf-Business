const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// חיבור למסד הנתונים
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ מחובר למסד הנתונים של TPG'))
    .catch(err => console.error('❌ שגיאת חיבור ל-DB:', err));

const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    status: { type: String, default: 'START' }
});

async function sendMenu(chatId) {
    // התיקון כאן: הוספתי את המקף ב-green-api.com והשתמשתי בכתובת הכללית
    const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendTemplateMessage/${API_TOKEN}`;
    
    const data = {
        chatId: chatId,
        templateMessage: {
            content: { text: "ברוכים הבאים ל-TPG! 👋\nאיך נוכל לעזור היום?" },
            buttons: [
                { index: 1, quickReplyButton: { displayText: "קצת עלינו", id: "about" } },
                { index: 2, quickReplyButton: { displayText: "נציג אנושי", id: "human" } }
            ]
        }
    };

    try { 
        await axios.post(url, data); 
        console.log(`✅ תפריט נשלח ל-${chatId}`);
    } catch (e) { 
        console.error("❌ שגיאה בשליחת הודעה:", e.response?.data || e.message); 
    }
}

app.post('/webhook', async (req, res) => {
    try {
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const chatId = req.body.senderData.chatId;
            const senderName = req.body.senderData.senderName;
            
            // שומר את הלקוח בזיכרון
            await Client.findOneAndUpdate({ chatId }, { name: senderName }, { upsert: true });
            
            // שולח את התפריט
            await sendMenu(chatId);
        }
    } catch (e) { 
        console.error("❌ שגיאה ב-Webhook:", e.message); 
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send("🚀 TPG System is Online and Healthy!"));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
