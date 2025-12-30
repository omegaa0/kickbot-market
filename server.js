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

const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const REDIRECT_URI = "https://aloskegangbot-market.onrender.com/auth/kick/callback";

// PKCE YARDIMCILARI
function base64UrlEncode(str) { return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
function generatePKCE() {
    const verifier = base64UrlEncode(crypto.randomBytes(32));
    const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

// ---------------------------------------------------------
// 2. AUTH & CALLBACK (BOT KİMLİĞİ TESPİTİ)
// ---------------------------------------------------------
app.get('/login', async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();
    await db.ref('temp_auth/' + state).set({ verifier, createdAt: Date.now() });
    const scopes = "chat:write events:subscribe user:read channel:read";
    const authUrl = `https://id.kick.com/oauth/authorize?client_id=${KICK_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
    res.redirect(authUrl);
});

app.get('/auth/kick/callback', async (req, res) => {
    const { code, state } = req.query;
    const tempAuth = (await db.ref('temp_auth/' + state).once('value')).val();
    if (!tempAuth) return res.send("Oturum zaman aşımı. /login adresine tekrar git.");
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', KICK_CLIENT_ID);
        params.append('client_secret', KICK_CLIENT_SECRET);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('code_verifier', tempAuth.verifier);

        const response = await axios.post('https://id.kick.com/oauth/token', params);
        const { access_token, refresh_token } = response.data;

        // Giriş yapan kanalın IDsini al (Mesaj gönderirken lazım olacak)
        const userRes = await axios.get('https://api.kick.com/public/v1/users', {
            headers: { 'Authorization': `Bearer ${access_token}` }
        });

        const userData = userRes.data.data[0];
        const broadcasterId = userData.user_id;

        // Tokenları ve Kanal ID'sini Kaydet
        await db.ref('bot_tokens').set({
            access_token,
            refresh_token,
            broadcaster_id: broadcasterId,
            updatedAt: Date.now()
        });

        // Kanalı dinlemeye başla (Abonelik)
        await subscribeToChat(access_token, broadcasterId);

        res.send(`<body style='background:#111;color:lime;text-align:center;padding-top:100px;font-family:sans-serif;'>
            <h1 style='font-size:3rem;'>✅ SISTEM HAZIR!</h1>
            <p style='font-size:1.5rem;'>AloskeGangBOT artık kanalınızda aktif.</p>
            <p style='color:#888;'>Giriş yapan: ${userData.name}</p>
        </body>`);
    } catch (e) { res.status(500).json({ error: "Giriş hatası", detay: e.message }); }
});

async function subscribeToChat(token, broadcasterId) {
    try {
        await axios.post('https://api.kick.com/public/v1/events/subscriptions', {
            broadcaster_user_id: parseInt(broadcasterId),
            events: [{ name: "chat.message.sent", version: 1 }],
            method: "webhook"
        }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log(`✅ Mesaj dinleyici aktif: ${broadcasterId}`);
    } catch (e) { console.error("Abonelik hatası:", e.response?.data || e.message); }
}

// ---------------------------------------------------------
// 3. MESAJ MOTORU (SİSTEM BOTU OLARAK GÖNDERME)
// ---------------------------------------------------------
async function sendChatMessage(content) {
    const snap = await db.ref('bot_tokens').once('value');
    const data = snap.val();
    if (!data) return;
    try {
        // 🔥 BURASI KRİTİK: 'bot' tipi AloskeGangBOT kimliğini kullanır!
        await axios.post(`https://api.kick.com/public/v1/chat`, {
            content: content,
            type: "bot",
            broadcaster_user_id: parseInt(data.broadcaster_id)
        }, {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        });
        console.log(`📤 Sunucu Botu Gönderdi: ${content}`);
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
    if (!tokenData) return;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', tokenData.refresh_token);
    params.append('client_id', KICK_CLIENT_ID);
    params.append('client_secret', KICK_CLIENT_SECRET);
    try {
        const res = await axios.post('https://id.kick.com/oauth/token', params);
        await db.ref('bot_tokens').update({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
    } catch (e) { }
}

// ---------------------------------------------------------
// 4. WEBHOOK (DINLEYICI & CEVAPCI)
// ---------------------------------------------------------
app.post('/kick/webhook', async (req, res) => {
    const payload = req.body;
    res.status(200).send('OK');

    const event = payload.data ? payload.data : payload;
    const type = payload.type || "chat.message.sent";

    // Eğer mesaj chat mesajı ise
    if (type === 'chat.message.sent' || event.content) {
        const user = event.sender?.username;
        const msg = event.content?.trim().toLowerCase();

        if (!user || !msg) return;

        // Kendi bot ismimizi chate yansıtmıyoruz (Loop Protection)
        if (user.toLowerCase().includes("aloskegangbot")) return;

        console.log(`📩 [WEBHOOK] ${user}: ${msg}`);

        if (msg === '!selam' || msg === 'sa') {
            await sendChatMessage(`Aleyküm selam @${user}! AloskeGangBOT 7/24 hizmetinizde. 🦾`);
        }
        else if (msg === '!bakiye') {
            const uSnap = await db.ref('users/' + user.toLowerCase()).once('value');
            const balance = uSnap.val()?.balance || 1000;
            await sendChatMessage(`@${user}, Mevcut Bakiyeniz: ${balance.toLocaleString()} 💰`);
        }
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MASTER BOT v16.3 YAYINDA!`));
