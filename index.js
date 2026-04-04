const express = require('express');
const app = express();

// הגדרה שמאפשרת לשרת לקרוא את הנתונים שמגיעים מוואטסאפ
app.use(express.json());

const PORT = process.env.PORT || 8000;

// נתיב בדיקה לראות שהשרת חי (כשנכנסים לכתובת בדפדפן)
app.get('/', (req, res) => {
    res.send('🚀 TPG Server is Running Perfectly!');
});

// נתיב ה-Webhook - לכאן Green API ישלח את ההודעות הנכנסות
app.post('/webhook', (req, res) => {
    const data = req.body;
    
    // מדפיס לקונסול את ההודעה כדי שנוכל לראות אותה בשרת
    console.log('✅ התקבלה פניה חדשה מלקוח:', JSON.stringify(data, null, 2));

    // כאן נוסיף בהמשך את כל הלוגיקה של הבוט:
    // זיהוי לחיצה על "עלינו", ניתוב לנציג, ושמירה במסד נתונים

    // השרת חייב להחזיר תשובת OK לגרין API כדי שלא ישלחו שוב ושוב
    res.status(200).send('OK');
});

// הפעלת השרת
app.listen(PORT, () => {
    console.log(`TPG Bot Server is listening on port ${PORT}`);
});
