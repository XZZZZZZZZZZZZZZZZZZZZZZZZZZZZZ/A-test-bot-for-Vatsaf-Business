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
    lastInteraction: { type: Date, default: Date.now }
});

async function sendResponse(chatId, text) {
    // כתובת מדויקת לשרת 7107 שלך
    const url = `https://7107.api.green-api.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    
    const data = {
        chatId: chatId,
        message: text
    };

    try { 
        await axios.post(url, data); 
        console.log(`✅ הודעה נשלחה בהצלחה ל-${chatId}`);
    } catch (e) { 
        console.error("❌ שגיאה בשליחת הודעה:", e.response?.data || e.message); 
    }
}

app.post('/webhook', async (req, res) => {
    try {
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const chatId = req.body.senderData.chatId;
            const senderName = req.body.senderData.senderName;
            
            // שומר את הלקוח בזיכרון (CRM)
            await Client.findOneAndUpdate({ chatId }, { name: senderName, lastInteraction: new Date() }, { upsert: true });
            
            console.log(`📩 התקבלה הודעה מ-${senderName}`);

            // תשובה אוטומטית ראשונית (במקום כפתורים, כדי לוודא שהחיבור עובד)
            const welcomeText = `שלום ${senderName}! 👋\nברוכים הבאים ל-TPG.\nהמערכת שלנו רשמה אותך. איך נוכל לעזור?`;
            await sendResponse(chatId, welcomeText);
        }
    } catch (e) { 
        console.error("❌ שגיאה ב-Webhook:", e.message); 
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send("🚀 TPG System is Online and Connected to DB!"));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
