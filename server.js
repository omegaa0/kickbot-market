require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto'); // Güvenlik anahtarları için
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

// 3. GÜVENLİK ANAHTARI ÜRETİCİSİ (PKCE & STATE)
function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

// 4. LOGIN ENDPOINT (YENİLENMİŞ GÜVENLİ SÜRÜM)
app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    const scopes = "chat:write events:subscribe user:read";

    // Kick artık 'state' parametresini ZORUNLU kılıyor.
    const authUrl = `https://id.kick.com/oauth/authorize?` +
        `client_id=${KICK_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}`; // State eklendi!

    console.log("🔗 Giriş isteği başlatıldı, state:", state);
    res.redirect(authUrl);
});

// 5. CALLBACK (Kayıt ve Onay)
app.get('/auth/kick/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return res.status(400).send(`Hata: ${error}`);
    if (!code) return res.status(400).send("Kod alınamadı.");

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', KICK_CLIENT_ID);
        params.append('client_secret', KICK_CLIENT_SECRET);
        params.append('redirect_uri', REDIRECT_URI);

        const response = await axios.post('https://id.kick.com/oauth/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token } = response.data;
        await db.ref('bot_tokens').set({ access_token, refresh_token, updatedAt: Date.now() });

        res.send("<h1>✅ BOT BAĞLANDI!</h1><p>Kick API kapıları açıldı. Artık chatte fırtınalar estirebiliriz.</p>");
    } catch (e) {
        console.error("Callback Hatası:", e.response?.data || e.message);
        res.status(500).send("Giriş işlemi başarısız: " + (e.response?.data?.message || e.message));
    }
});

// 6. MESAJ GÖNDERME KODU
async function sendChatMessage(content) {
    try {
        const snap = await db.ref('bot_tokens').once('value');
        const tokenData = snap.val();
        if (!tokenData) return console.log("Bot girişi yok!");

        await axios.post(`https://api.kick.com/public/v1/chat`, {
            content: content,
            type: "bot"
        }, {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        console.log(`📤 Bot Mesajı gönderildi: ${content}`);
    } catch (e) {
        if (e.response?.status === 401) {
            console.log("🔄 Token dolmuş, yenileniyor...");
            await refreshMyToken();
            return sendChatMessage(content);
        }
        console.error("Mesaj Hatası:", e.response?.data || e.message);
    }
}

async function refreshMyToken() {
    const snap = await db.ref('bot_tokens').once('value');
    const tokenData = snap.val();
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', tokenData.refresh_token);
    params.append('client_id', KICK_CLIENT_ID);
    params.append('client_secret', KICK_CLIENT_SECRET);

    const res = await axios.post('https://id.kick.com/oauth/token', params);
    await db.ref('bot_tokens').update({
        access_token: res.data.access_token,
        refresh_token: res.data.refresh_token,
        updatedAt: Date.now()
    });
}

// 7. WEBHOOK
app.post('/kick/webhook', async (req, res) => {
    const event = req.body;
    if (event.type === 'chat.message.sent') {
        const user = event.data.sender.username;
        const msg = event.data.content.toLowerCase();
        if (msg === '!selam') await sendChatMessage(`Aleyküm selam @${user}! 💪`);
        if (msg === '!bakiye') {
            const uSnap = await db.ref('users/' + user.toLowerCase()).once('value');
            const b = uSnap.val()?.balance || 1000;
            await sendChatMessage(`@${user}, Bakiyeniz: ${b.toLocaleString()} �`);
        }
    }
    res.status(200).send('OK');
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Bot Sunucusu Aktif! Port: ${PORT}`);
});
