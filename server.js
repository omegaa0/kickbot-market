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

// GLOBAL STATES
const activeDuels = {};
let currentHeist = null;
let activePiyango = null;
let activePrediction = null;

// PKCE YARDIMCILARI
function base64UrlEncode(str) { return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
function generatePKCE() {
    const verifier = base64UrlEncode(crypto.randomBytes(32));
    const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

// ---------------------------------------------------------
// 2. AUTH & CALLBACK
// ---------------------------------------------------------
app.get('/login', async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();
    await db.ref('temp_auth/' + state).set({ verifier, createdAt: Date.now() });
    const scopes = "chat:write events:subscribe user:read channel:read moderation:ban";
    const authUrl = `https://id.kick.com/oauth/authorize?client_id=${KICK_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
    res.redirect(authUrl);
});

app.get('/auth/kick/callback', async (req, res) => {
    const { code, state } = req.query;
    const tempAuth = (await db.ref('temp_auth/' + state).once('value')).val();
    if (!tempAuth) return res.send("Oturum zaman aşımı. /login tekrar git.");
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
        const userRes = await axios.get('https://api.kick.com/public/v1/users', { headers: { 'Authorization': `Bearer ${access_token}` } });
        const userData = userRes.data.data[0];
        await db.ref('bot_tokens').set({ access_token, refresh_token, broadcaster_id: userData.user_id, bot_username: userData.name.toLowerCase(), updatedAt: Date.now() });
        await subscribeToChat(access_token, userData.user_id);
        res.send(`<body style='background:#111;color:lime;text-align:center;padding-top:100px;font-family:sans-serif;'><h1>✅ SISTEM KURULDU!</h1><p>Bot @${userData.name} olarak konuşmaya hazır.</p></body>`);
    } catch (e) { res.status(500).json({ error: "Hata", msg: e.message }); }
});

async function subscribeToChat(token, broadcasterId) {
    try {
        await axios.post('https://api.kick.com/public/v1/events/subscriptions', {
            broadcaster_user_id: parseInt(broadcasterId),
            events: [{ name: "chat.message.sent", version: 1 }],
            method: "webhook"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) { console.error("Abonelik hatası:", e.message); }
}

// ---------------------------------------------------------
// 3. MESAJ MOTORU
// ---------------------------------------------------------
async function sendChatMessage(content) {
    const snap = await db.ref('bot_tokens').once('value');
    const data = snap.val();
    if (!data) return;
    try {
        await axios.post(`https://api.kick.com/public/v1/chat`, { content, type: "bot", broadcaster_user_id: parseInt(data.broadcaster_id) }, {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        });
        console.log(`📤 Sunucu Botu: ${content}`);
    } catch (e) {
        if (e.response?.status === 401) { await refreshMyToken(); return sendChatMessage(content); }
    }
}

async function refreshMyToken() {
    const snap = await db.ref('bot_tokens').once('value');
    if (!snap.val()) return;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', snap.val().refresh_token);
    params.append('client_id', KICK_CLIENT_ID);
    params.append('client_secret', KICK_CLIENT_SECRET);
    try {
        const res = await axios.post('https://id.kick.com/oauth/token', params);
        await db.ref('bot_tokens').update({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
    } catch (e) { }
}

// ---------------------------------------------------------
// 4. WEBHOOK (KOMUT MOTORU - TAM VERSİYON)
// ---------------------------------------------------------
app.post('/kick/webhook', async (req, res) => {
    const payload = req.body;
    res.status(200).send('OK');
    const event = payload.data || payload;
    const user = event.sender?.username;
    const rawMsg = event.content;
    if (!user || !rawMsg) return;
    const msg = rawMsg.trim();
    const lowMsg = msg.toLowerCase();
    const args = msg.split(/\s+/).slice(1);
    const userRef = db.ref('users/' + user.toLowerCase());

    // Protection
    const botSnap = await db.ref('bot_tokens').once('value');
    if (user.toLowerCase() === botSnap.val()?.bot_username) return;

    // --- EKONOMİ & SİSTEM ---
    if (lowMsg === '!komutlar') {
        await sendChatMessage(`🎮 Komutlar: !bakiye, !günlük, !slot, !yazitura, !kutu, !soygun, !duello, !market, !zenginler, !fal, !kaderim, !ship, !piyango`);
    }
    else if (lowMsg === '!ping') await sendChatMessage(`Pong! ✅ 7/24 Aktif.`);
    else if (lowMsg === '!bakiye') {
        const snap = await userRef.once('value');
        await sendChatMessage(`@${user}, Bakiyeniz: ${(snap.val()?.balance || 1000).toLocaleString()} 💰`);
    }

    // --- SLOT (SAATTE 10 KERE SINIRI) ---
    else if (lowMsg.startsWith('!slot')) {
        const cost = Math.max(10, parseInt(args[0]) || 100);
        const snap = await userRef.once('value');
        const data = snap.val() || { balance: 1000 };
        const now = Date.now();

        // Sınır Kontrolü
        if (!data.slot_reset || now > data.slot_reset) {
            data.slot_count = 0;
            data.slot_reset = now + (60 * 60 * 1000); // 1 Saat
        }
        if (data.slot_count >= 10) {
            const minKalan = Math.ceil((data.slot_reset - now) / 60000);
            return await sendChatMessage(`@${user}, � Slot limitine ulaştın! (Saatte maks 10). Kalan süre: ${minKalan} dk.`);
        }

        if (data.balance < cost) return await sendChatMessage(`@${user}, Bakiye yetersiz!`);
        data.balance -= cost; data.slot_count++;
        const sym = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣", "🍉", "🍀"];
        const resSlot = [sym[Math.floor(Math.random() * 8)], sym[Math.floor(Math.random() * 8)], sym[Math.floor(Math.random() * 8)]];
        let prize = (resSlot[0] === resSlot[1] && resSlot[1] === resSlot[2]) ? cost * 5 : (resSlot[0] === resSlot[1] || resSlot[1] === resSlot[2] || resSlot[0] === resSlot[2]) ? cost * 1.5 : 0;
        if (prize === 0) data.balance += Math.floor(cost * 0.1);
        data.balance += Math.floor(prize); await userRef.set(data);
        await sendChatMessage(`🎰 | ${resSlot.join('|')} | @${user} ${prize > 0 ? `KAZANDIN! (+${prize})` : `Kaybettin. (+${Math.floor(cost * 0.1)} İade)`} (${data.slot_count}/10)`);
    }

    // --- DUEL SİSTEMİ ---
    else if (lowMsg.startsWith('!duello')) {
        const target = args[0]?.replace('@', '').toLowerCase();
        const amt = parseInt(args[1]);
        if (!target || isNaN(amt)) return await sendChatMessage(`@${user}, !duello @isim [miktar]`);
        activeDuels[target] = { challenger: user, amount: amt, expire: Date.now() + 60000 };
        await sendChatMessage(`⚔️ @${target}, @${user} sana meydan okudu (${amt} 💰)! Kabul: !kabul`);
    }
    else if (lowMsg === '!kabul') {
        const duel = activeDuels[user.toLowerCase()];
        if (!duel || Date.now() > duel.expire) return;
        delete activeDuels[user.toLowerCase()];
        const winner = Math.random() < 0.5 ? duel.challenger : user;
        const loser = winner === user ? duel.challenger : user;
        await db.ref('users/' + winner.toLowerCase()).transaction(u => { if (u) u.balance += duel.amount; return u; });
        await db.ref('users/' + loser.toLowerCase()).transaction(u => { if (u) u.balance -= duel.amount; return u; });
        await sendChatMessage(`🏆 @${winner} kazandı! ${duel.amount} 💰 kaptı. ⚔️`);
    }

    // --- PİYANGO (ADMIN) ---
    else if (lowMsg.startsWith('!piyango')) {
        const sub = args[0];
        if (sub === "başla" && user.toLowerCase() === "omegacyr") {
            activePiyango = { participants: [], cost: parseInt(args[1]) || 500, pool: 0 };
            await sendChatMessage(`🎰 PİYANGO BAŞLADI! Katılmak için !piyango katıl yazın. Ücret: ${activePiyango.cost} �`);
        } else if (sub === "katıl" && activePiyango) {
            if (activePiyango.participants.includes(user.toLowerCase())) return;
            await userRef.transaction(u => { if (u && u.balance >= activePiyango.cost) { u.balance -= activePiyango.cost; activePiyango.pool += activePiyango.cost; activePiyango.participants.push(user.toLowerCase()); } return u; });
            await sendChatMessage(`🎟️ @${user} piyangoya girdi! (Havuz: ${activePiyango.pool} 💰)`);
        } else if (sub === "bitir" && user.toLowerCase() === "omegacyr" && activePiyango) {
            const winner = activePiyango.participants[Math.floor(Math.random() * activePiyango.participants.length)];
            const prize = activePiyango.pool;
            await db.ref('users/' + winner).transaction(u => { if (u) u.balance += prize; return u; });
            await sendChatMessage(`🎉 TALİHLİ: @${winner}! Tam ${prize} 💰 kazandı! 🎊`); activePiyango = null;
        }
    }

    // --- DİĞER KOMUTLAR ---
    else if (lowMsg === '!zenginler') {
        const allUsers = (await db.ref('users').once('value')).val();
        const sorted = Object.entries(allUsers || {}).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 5);
        let txt = "🏆 TOP 5 ZENGİN: ";
        sorted.forEach((u, i) => txt += `${i + 1}. @${u[0]} (${u[1].balance.toLocaleString()}) | `);
        await sendChatMessage(txt.slice(0, -3));
    }
    else if (lowMsg === '!kaderim') {
        const kade = ["Ünlü bir Yayıncı 📹", "Milyarder 💰", "Dünya Gezgini ✈️", "Mafya Babası 🕶️"];
        await sendChatMessage(`@${user}, Kaderinde şu var: ${kade[Math.floor(Math.random() * kade.length)]}`);
    }
    else if (lowMsg === '!söz') {
        const sozler = ["Zoru başarırız, imkansız vakit alır.", "En büyük intikam başarıdır."];
        await sendChatMessage(`✍️ @${user}, ${sozler[Math.floor(Math.random() * sozler.length)]}`);
    }
    else if (lowMsg.startsWith('!doğrulama')) {
        const code = args[0];
        const snap = await db.ref('pending_verifications/' + code).once('value');
        if (snap.exists()) {
            await userRef.update({ verified: true });
            await db.ref('pending_verifications/' + code).remove();
            await sendChatMessage(`✅ @${user}, Hesabın doğrulandı!`);
        } else await sendChatMessage(`❌ Geçersiz kod @${user}.`);
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });
app.listen(process.env.PORT || 3000, () => console.log(`🚀 MASTER v16.4 FULL AKTIF!`));
