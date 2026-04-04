# משתמשים בגרסה יציבה של Node.js
FROM node:22-slim

# מגדירים את תיקיית העבודה בתוך הקופסה
WORKDIR /app

# מעתיקים רק את רשימת הספריות
COPY package.json ./

# מתקינים את הספריות (בלי לבקש אישור מה-lockfile)
RUN npm install

# מעתיקים את כל שאר הקוד (index.js וכו')
COPY . .

# פותחים את הפורט שבו הבוט מקשיב
EXPOSE 8000

# הפקודה שמפעילה את הבוט
CMD ["node", "index.js"]
