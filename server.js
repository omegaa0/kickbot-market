require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
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

// 3. PKCE & GÜVENLİK YARDIMCILARI
function base64UrlEncode(str) {
    return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
    const verifier = base64UrlEncode(crypto.randomBytes(32));
    const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

// 4. LOGIN ENDPOINT (OAuth 2.1 FULL PKCE)
app.get('/login', async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();

    // Geçici olarak bu state'e bağlı verifier'ı Firebase'e kaydet (10 dk geçerli)
    await db.ref('temp_auth/' + state).set({
        verifier: verifier,
        createdAt: Date.now()
    });

    const scopes = "chat:write events:subscribe user:read channel:read";

    const authUrl = `https://id.kick.com/oauth/authorize?` +
        `client_id=${KICK_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}` +
        `&code_challenge=${challenge}` +
        `&code_challenge_method=S256`; // Kick bu parametreleri ZORUNLU tutuyor!

    console.log("� Giriş isteği gönderiliyor (PKCE Aktif)");
    res.redirect(authUrl);
});

// 5. CALLBACK (Token Değişimi)
app.get('/auth/kick/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return res.status(400).send(`Kick Hatası: ${error}`);

    const tempAuth = (await db.ref('temp_auth/' + state).once('value')).val();
    if (!tempAuth) return res.status(400).send("Geçersiz veya süresi dolmuş oturum (State mismatch).");

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', KICK_CLIENT_ID);
        params.append('client_secret', KICK_CLIENT_SECRET);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('code_verifier', tempAuth.verifier);

        // Bazı Kick API sürümleri Client Secret'ı hem body'de hem de header'da bekleyebilir.
        const authHeader = Buffer.from(`${KICK_CLIENT_ID}:${KICK_CLIENT_SECRET}`).toString('base64');

        const response = await axios.post('https://id.kick.com/oauth/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${authHeader}`
            }
        });

        const { access_token, refresh_token } = response.data;
        await db.ref('bot_tokens').set({ access_token, refresh_token, updatedAt: Date.now() });
        await db.ref('temp_auth/' + state).remove(); // Temizlik

        res.send("<h1>✅ BOT BAĞLANDI!</h1><p>Kick OAuth 2.1 protokolü başarıyla tamamlandı. Bot aktif!</p>");
    } catch (e) {
        console.error("Token Hatası:", e.response?.data || e.message);
        res.status(500).send("Giriş işlemi başarısız: " + (e.response?.data?.message || e.message));
    }
});

// 6. MESAJ GÖNDERME
async function sendChatMessage(content) {
    const snap = await db.ref('bot_tokens').once('value');
    const tokenData = snap.val();
    if (!tokenData) return;

    try {
        await axios.post(`https://api.kick.com/public/v1/chat`, {
            content: content,
            type: "bot"
        }, {
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
    } catch (e) {
        if (e.response?.status === 401) {
            await refreshMyToken();
            return sendChatMessage(content);
        }
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
        if (msg === '!selam') await sendChatMessage(`Aleyküm selam @${user}! �`);
    }
    res.status(200).send('OK');
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PKCE Bot Aktif! Port: ${PORT}`));
