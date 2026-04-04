const express = require('express');
const axios = require('axios'); // ספריה שמאפשרת לנו להוציא בקשות לשרתים אחרים (כמו גרין API)
const app = express();

app.use(express.json());
const PORT = process.env.PORT || 8000;

// המשתנים האלה יימשכו אוטומטית מ-Koyeb כשנחבר הכל
const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;

// פונקציה חכמה ששולחת הודעות וואטסאפ דרך Green API
async function sendWhatsAppMessage(chatId, messageText) {
    // שים לב ששמתי פה את השרת הספציפי שלך (7107) כדי שזה יעבוד מושלם
    const url = `https://7107.api.greenapi.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    
    try {
        await axios.post(url, {
            chatId: chatId,
            message: messageText
        });
        console.log(`✅ הודעה נשלחה בהצלחה ל: ${chatId}`);
    } catch (error) {
        console.error('❌ שגיאה בשליחת הודעה:', error.message);
    }
}

// נתיב בדיקה לדפדפן
app.get('/', (req, res) => {
    res.send('🚀 TPG Server is Running Perfectly!');
});

// המוח של הבוט - מקבל הודעות, מנתח אותן, ומגיב
app.post('/webhook', async (req, res) => {
    // מיד מחזירים תשובה כדי שגרין API לא יחשוב שהשרת שלנו תקוע
    res.status(200).send('OK');
    
    const data = req.body;
    
    // מוודאים שזו באמת הודעת טקסט נכנסת מלקוח
    if (data && data.typeWebhook === 'incomingMessageReceived') {
        const messageData = data.messageData;
        const senderData = data.senderData;
        
        if (messageData && messageData.typeMessage === 'textMessage') {
            const incomingText = messageData.textMessageData.textMessage.trim();
            const chatId = senderData.chatId;

            console.log(`📩 הודעה חדשה מ-${chatId}: ${incomingText}`);

            // === לוגיקת התפריט של TPG ===
            
            if (incomingText === 'שלום' || incomingText === 'היי') {
                const menu = "ברוכים הבאים ל-TPG! 👋\n\nאנא בחר אפשרות:\n1️⃣ קצת עלינו\n2️⃣ מעבר לנציג אנושי";
                await sendWhatsAppMessage(chatId, menu);
            } 
            else if (incomingText === '1') {
                const aboutText = "אנחנו TPG, מערכת ה-CRM והשירות המובילה בישראל! 🚀\nאנחנו כאן כדי לתת לך את הפתרונות המהירים והטובים ביותר.";
                await sendWhatsAppMessage(chatId, aboutText);
            }
            else if (incomingText === '2') {
                const agentText = "הפניה שלך התקבלה בהצלחה! ⏳\nנציג אנושי שלנו יעבור על הפניה ויענה לך בהקדם האפשרי.";
                await sendWhatsAppMessage(chatId, agentText);
                
                // כאן תבוא הלוגיקה ששולחת את השיחה למנהל/נציג פנוי
            }
            else {
                // תשובת ברירת מחדל אם הלקוח שלח משהו לא ברור
                await sendWhatsAppMessage(chatId, "לא כל כך הבנתי... 😅\nאנא שלח 'שלום' כדי לראות את התפריט הראשי.");
            }
        }
    }
});

// הדלקת השרת
app.listen(PORT, () => {
    console.log(`TPG Bot Server is listening on port ${PORT}`);
});
