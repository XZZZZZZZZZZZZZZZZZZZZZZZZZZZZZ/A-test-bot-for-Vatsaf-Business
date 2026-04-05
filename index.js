const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

// משיכת המפתחות מהגדרות השרת
const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// חיבור למסד הנתונים
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ הבוט מחובר לזיכרון ב-MongoDB'))
    .catch(err => console.error('❌ שגיאת חיבור למסד נתונים:', err));

// הגדרת מבנה הלקוח בזיכרון
const Client = mongoose.model('Client', {
    chatId: String,
    name: String,
    lastInteraction: { type: Date, default: Date.now }
});

// פונקציה לשליחת כפתורים (Interactive)
async function sendMenu(chatId) {
    const url = `https://7103.api.greenapi.com/waInstance${INSTANCE_ID}/sendTemplateMessage/${API_TOKEN}`;
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
    } catch (e) { 
        console.error("שגיאה בשליחת הודעה:", e.message); 
    }
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    // בודק אם זו הודעה נכנסת
    if (body.typeWebhook === 'incomingMessageReceived') {
        const chatId = body.senderData.chatId;
        const senderName = body.senderData.senderName;

        // "זוכר" את הלקוח - שומר או מעדכן ב-MongoDB
        await Client.findOneAndUpdate(
            { chatId: chatId },
            { name: senderName, lastInteraction: new Date() },
            { upsert: true }
        );

        console.log(`📩 התקבלה הודעה מ-${senderName}`);
        
        // שולח את תפריט הכפתורים
        await sendMenu(chatId);
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send("🚀 TPG CRM is Online and Recording!"));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
