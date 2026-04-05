const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const INSTANCE_ID = process.env.INSTANCE_ID;
const API_TOKEN = process.env.API_TOKEN;

// פונקציה לשליחת כפתורים
async function sendButtons(chatId, text, buttons) {
    const url = `https://7103.api.greenapi.com/waInstance${INSTANCE_ID}/sendTemplateMessage/${API_TOKEN}`;
    const formattedButtons = buttons.map((btn, index) => ({
        index: index + 1,
        quickReplyButton: { displayText: btn.text, id: btn.id }
    }));

    try {
        await axios.post(url, {
            chatId: chatId,
            templateMessage: {
                content: { text: text },
                buttons: formattedButtons
            }
        });
    } catch (e) { console.error("Error sending buttons", e); }
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.typeWebhook === 'incomingMessageReceived') {
        const chatId = body.senderData.chatId;
        const text = body.messageData.textMessageData?.textMessage || "";

        // לוגיקה: אם הלקוח לחץ על כפתור או שלח מילה
        if (text === 'קצת עלינו') {
            await axios.post(`https://7103.api.greenapi.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`, {
                chatId: chatId,
                message: "TPG היא החברה המובילה לפתרונות אוטומציה לעסקים! 🚀"
            });
        } 
        else if (text === 'נציג אנושי') {
            await axios.post(`https://7103.api.greenapi.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`, {
                chatId: chatId,
                message: "מעביר אותך לנציג, מיד נחזור אליך... 👨‍💻"
            });
        }
        // ברירת מחדל: תמיד שולח תפריט כפתורים
        else {
            await sendButtons(chatId, "ברוכים הבאים ל-TPG! 👋\nאיך נוכל לעזור?", [
                { text: "קצת עלינו", id: "btn1" },
                { text: "נציג אנושי", id: "btn2" }
            ]);
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send("🚀 TPG Server is Running Perfectly!"));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
