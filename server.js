require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.static(__dirname));
app.use(bodyParser.json());

// 1. FIREBASE ADMIN INITIALIZATION (En Garanti Yöntem)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            // Not: Admin SDK için JSON dosyası gerekir ama biz Database URL ile devam edebiliriz
            // Eğer hata verirse sadece Database URL ve API Key ile bağlanacağız.
        }),
        databaseURL: process.env.FIREBASE_DB_URL
    });
}
const db = admin.database();

// 2. KICK API CONFIG
const KICK_API_BASE = "https://api.kick.com/v1";
let authToken = null;

async function refreshAccessToken() {
    try {
        const response = await axios.post('https://id.kick.com/oauth/token', {
            grant_type: 'client_credentials',
            client_id: process.env.KICK_CLIENT_ID,
            client_secret: process.env.KICK_CLIENT_SECRET,
            scope: 'chat.message:write chat.message:read'
        });
        authToken = response.data.access_token;
        console.log("🔑 [Kick API] Access Token yenilendi.");
    } catch (error) {
        console.error("❌ [Kick API] Token alınamadı:", error.response?.data || error.message);
    }
}

async function sendChatMessage(content) {
    if (!authToken) await refreshAccessToken();
    try {
        await axios.post(`${KICK_API_BASE}/chat`, {
            content: content
        }, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (e) { console.error("Mesaj gönderilemedi:", e.message); }
}

// 3. YARDIMCI FONKSİYONLAR
async function getUserData(u) {
    const clean = u.toLowerCase().trim();
    const snap = await db.ref('users/' + clean).once('value');
    return snap.val() || { balance: 1000, lastDaily: 0 };
}

async function saveUserData(u, d) {
    const clean = u.toLowerCase().trim();
    return db.ref('users/' + clean).set(d);
}

// 4. WEBHOOK HANDLER
app.post('/kick/webhook', async (req, res) => {
    const event = req.body;
    console.log("📩 Webhook Event:", event.type);

    if (event.type === 'chat.message.sent') {
        const { content, sender } = event.data;
        const user = sender.username;
        const message = content.trim().toLowerCase();

        if (message === '!selam') await sendChatMessage(`Aleyküm selam @${user}! 👋`);
        if (message === '!bakiye') {
            const data = await getUserData(user);
            await sendChatMessage(`@${user}, Bakiyeniz: ${data.balance.toLocaleString()} 💰`);
        }
    }
    res.status(200).send('OK');
});

// 5. ANA SAYFA
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'shop.html'));
});

// 6. SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 KickBot Official API on Port ${PORT}`);
    await refreshAccessToken();
});
