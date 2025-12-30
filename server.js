require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const firebase = require('firebase/compat/app');
require('firebase/compat/database');

const app = express();
app.use(express.static(__dirname));
app.use(bodyParser.json());

// 1. FIREBASE INITIALIZATION
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    databaseURL: process.env.FIREBASE_DB_URL
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 2. KICK API CONFIG
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const REDIRECT_URI = "https://aloskegangbot-market.onrender.com/auth/kick/callback";

// 3. OAUTH YÖNETİMİ (Kalıcı Bot Girişi)
app.get('/login', (req, res) => {
    const scopes = "chat:write events:subscribe user:read";
    const authUrl = `https://id.kick.com/oauth/authorize?client_id=${KICK_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(authUrl);
});

app.get('/auth/kick/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', KICK_CLIENT_ID);
        params.append('client_secret', KICK_CLIENT_SECRET);
        params.append('redirect_uri', REDIRECT_URI);

        const response = await axios.post('https://id.kick.com/oauth/token', params);
        const { access_token, refresh_token } = response.data;

        // Refresh token'ı Firebase'e kaydet (Ölümsüz bilet!)
        await db.ref('bot_tokens').set({ access_token, refresh_token });

        res.send("<h1>✅ Bot Başarıyla Bağlandı!</h1><p>Artık pencereyi kapatabilirsin, bot çalışmaya başladı.</p>");
    } catch (e) {
        res.status(500).send("Giriş Hatası: " + (e.response?.data?.error_description || e.message));
    }
});

// 4. MESAJ GÖNDERME (TOKEN YENİLEME İLE)
async function sendChatMessage(content) {
    try {
        const tokenData = (await db.ref('bot_tokens').once('value')).val();
        if (!tokenData) return console.log("Bot girişi yapılmamış! Lütfen /login adresine gidin.");

        await axios.post(`https://api.kick.com/public/v1/chat`, {
            content: content,
            type: "bot"
        }, {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
    } catch (e) {
        if (e.response?.status === 401) {
            console.log("🔄 Token süresi dolmuş, yenileniyor...");
            await refreshMyToken();
            await sendChatMessage(content); // Tekrar dene
        }
    }
}

async function refreshMyToken() {
    const tokenData = (await db.ref('bot_tokens').once('value')).val();
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', tokenData.refresh_token);
    params.append('client_id', KICK_CLIENT_ID);
    params.append('client_secret', KICK_CLIENT_SECRET);

    const res = await axios.post('https://id.kick.com/oauth/token', params);
    await db.ref('bot_tokens').update({
        access_token: res.data.access_token,
        refresh_token: res.data.refresh_token
    });
}

// 5. WEBHOOK & MARKET
app.post('/kick/webhook', async (req, res) => {
    const event = req.body;
    if (event.type === 'chat.message.sent') {
        const user = event.data.sender.username;
        const msg = event.data.content.toLowerCase();
        if (msg === '!selam') await sendChatMessage(`Aleyküm selam @${user}! 👋`);
    }
    res.status(200).send('OK');
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot Sunucusu Aktif! Port: ${PORT}`));
