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

// PKCE
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
    if (!tempAuth) return res.send("Oturum zaman aşımı.");
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', KICK_CLIENT_ID);
        params.append('client_secret', KICK_CLIENT_SECRET);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('code_verifier', tempAuth.verifier);
        const response = await axios.post('https://id.kick.com/oauth/token', params);
        const userRes = await axios.get('https://api.kick.com/public/v1/users', { headers: { 'Authorization': `Bearer ${response.data.access_token}` } });
        const userData = userRes.data.data[0];
        await db.ref('bot_tokens').set({ access_token: response.data.access_token, refresh_token: response.data.refresh_token, broadcaster_id: userData.user_id, bot_username: userData.name.toLowerCase(), updatedAt: Date.now() });
        await subscribeToChat(response.data.access_token, userData.user_id);
        res.send(`<body style='background:#111;color:lime;text-align:center;padding-top:100px;'><h1>✅ BOT AKTIF!</h1></body>`);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

async function subscribeToChat(token, broadcasterId) {
    try {
        await axios.post('https://api.kick.com/public/v1/events/subscriptions', {
            broadcaster_user_id: parseInt(broadcasterId),
            events: [{ name: "chat.message.sent", version: 1 }],
            method: "webhook"
        }, { headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) { }
}

async function sendChatMessage(content) {
    const snap = await db.ref('bot_tokens').once('value');
    const data = snap.val();
    if (!data) return;
    try {
        await axios.post(`https://api.kick.com/public/v1/chat`, { content, type: "bot", broadcaster_user_id: parseInt(data.broadcaster_id) }, {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        });
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
    const res = await axios.post('https://id.kick.com/oauth/token', params);
    await db.ref('bot_tokens').update({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
}

// ---------------------------------------------------------
// 4. WEBHOOK (KOMUTLAR & OTO KAYIT)
// ---------------------------------------------------------
app.post('/kick/webhook', async (req, res) => {
    res.status(200).send('OK');
    const payload = req.body;
    const event = payload.data || payload;
    const user = event.sender?.username;
    const rawMsg = event.content;
    if (!user || !rawMsg) return;

    if (user.toLowerCase() === "aloskegangbot") return;

    const lowMsg = rawMsg.trim().toLowerCase();
    const args = rawMsg.trim().split(/\s+/).slice(1);
    const userRef = db.ref('users/' + user.toLowerCase());

    // --- OTOMATİK KAYIT ---
    const userSnap = await userRef.once('value');
    if (!userSnap.exists()) {
        // Yeni kullanıcı için başlangıç bakiyesi
        await userRef.set({ balance: 1000, created_at: Date.now() });
    }

    // --- ADMIN / MOD YETKİ KONTROLÜ ---
    const isAuthorized = event.sender?.identity?.badges?.some(b => b.type === 'broadcaster' || b.type === 'moderator') || user.toLowerCase() === "omegacyr";

    // --- TEMEL KOMUTLAR ---
    if (lowMsg === 'sa' || lowMsg === 'sea' || lowMsg === '!selam') {
        await sendChatMessage(`Aleyküm selam @${user}! AloskeGangBOT 7/24 aktif. 🦾`);
    }

    else if (lowMsg === '!bakiye') {
        const snap = await userRef.once('value');
        await sendChatMessage(`@${user}, Bakiyeniz: ${(snap.val()?.balance || 0).toLocaleString()} 💰`);
    }

    else if (lowMsg === '!günlük') {
        const snap = await userRef.once('value');
        const data = snap.val() || { balance: 1000, lastDaily: 0 };
        const now = Date.now();
        if (now - data.lastDaily < 86400000) {
            const diff = 86400000 - (now - data.lastDaily);
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return await sendChatMessage(`@${user}, ⏳ Günlük ödül için ${hours}sa ${mins}dk beklemelisin.`);
        }
        data.balance = (data.balance || 0) + 500;
        data.lastDaily = now;
        await userRef.set(data);
        await sendChatMessage(`🎁 @${user}, +500 💰 eklendi! ✅`);
    }

    // --- OYUNLAR (Slot, Yazitura, Kutu) ---
    else if (lowMsg.startsWith('!slot')) {
        const cost = Math.max(10, parseInt(args[0]) || 100);
        const snap = await userRef.once('value');
        const data = snap.val() || { balance: 1000, slot_count: 0, slot_reset: 0 };
        const now = Date.now();

        if (now > data.slot_reset) { data.slot_count = 0; data.slot_reset = now + 3600000; }
        if (data.slot_count >= 10) return await sendChatMessage(`@${user}, 🚨 Slot limitin doldu! (10/saat)`);

        if ((data.balance || 0) < cost) return await sendChatMessage(`@${user}, Yetersiz bakiye!`);

        data.balance -= cost; data.slot_count++;
        const sym = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣", "🍉", "🍀"];
        const s = [sym[Math.floor(Math.random() * 8)], sym[Math.floor(Math.random() * 8)], sym[Math.floor(Math.random() * 8)]];
        let mult = (s[0] === s[1] && s[1] === s[2]) ? 5 : (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) ? 1.5 : 0.1;

        const prize = Math.floor(cost * mult);
        data.balance += prize;
        await userRef.update(data);

        await sendChatMessage(`🎰 | ${s[0]} | ${s[1]} | ${s[2]} | @${user} ${mult >= 1.5 ? `KAZANDIN (+${prize})` : `Kaybettin (+${prize} İade)`}`);
    }

    else if (lowMsg.startsWith('!yazitura')) {
        const cost = parseInt(args[0]);
        const pick = args[1]?.toLowerCase();
        if (isNaN(cost) || !['y', 't', 'yazı', 'tura'].includes(pick)) return await sendChatMessage(`@${user}, Kullanım: !yazitura [miktar] [y/t]`);

        const snap = await userRef.once('value');
        const data = snap.val() || { balance: 0 };
        if (data.balance < cost) return await sendChatMessage(`@${user}, Bakiye yetersiz!`);

        data.balance -= cost;
        const res = Math.random() < 0.5 ? 'yazı' : 'tura';
        const isYazi = pick.startsWith('y');
        const win = (isYazi && res === 'yazı') || (!isYazi && res === 'tura');

        if (win) data.balance += cost * 2;
        await userRef.update({ balance: data.balance });
        await sendChatMessage(`🪙 Para fırlatıldı... ${res.toUpperCase()}! @${user} ${win ? `KAZANDIN (+${cost * 2})` : 'Kaybettin.'}`);
    }

    else if (lowMsg.startsWith('!kutu')) {
        const cost = parseInt(args[0]); const choice = parseInt(args[1]);
        if (isNaN(cost) || isNaN(choice) || choice < 1 || choice > 3) return await sendChatMessage(`@${user}, Kullanım: !kutu [miktar] [1-3]`);

        const snap = await userRef.once('value');
        const data = snap.val() || { balance: 0 };
        if (data.balance < cost) return await sendChatMessage(`@${user}, Bakiye yetersiz!`);

        data.balance -= cost;
        const prizeBox = Math.floor(Math.random() * 3) + 1;
        const win = choice === prizeBox;

        if (win) data.balance += cost * 3;
        await userRef.update({ balance: data.balance });
        await sendChatMessage(`📦 Kutu ${prizeBox} doluydu! @${user} ${win ? `DOĞRU! (+${cost * 3})` : 'Boş çıktı.'}`);
    }

    else if (lowMsg.startsWith('!duello')) {
        const target = args[0]?.replace('@', '').toLowerCase();
        const amt = parseInt(args[1]);
        if (!target || isNaN(amt)) return await sendChatMessage(`@${user}, Kullanım: !duello @target [miktar]`);
        activeDuels[target] = { challenger: user, amount: amt, expire: Date.now() + 60000 };
        await sendChatMessage(`⚔️ @${target}, @${user} sana ${amt} 💰 karşılığında meydan okudu! Kabul için: !kabul`);
    }

    else if (lowMsg === '!kabul') {
        const d = activeDuels[user.toLowerCase()];
        if (!d || Date.now() > d.expire) return;
        delete activeDuels[user.toLowerCase()];

        const winner = Math.random() < 0.5 ? d.challenger : user;
        const loser = winner === user ? d.challenger : user;

        await db.ref('users/' + winner.toLowerCase()).transaction(u => { if (u) u.balance += d.amount; return u; });
        await db.ref('users/' + loser.toLowerCase()).transaction(u => { if (u) u.balance -= d.amount; return u; });

        await sendChatMessage(`🏆 @${winner} düelloyu kazandı ve ${d.amount} 💰 kaptı! ⚔️`);
    }

    else if (lowMsg === '!soygun') {
        if (!currentHeist) {
            currentHeist = { p: [user], start: Date.now() };
            await sendChatMessage(`🚨 SOYGUN! Katılmak için !soygun yazın! (90sn)`);
            setTimeout(async () => {
                const h = currentHeist; currentHeist = null;
                if (!h || h.p.length < 3) return await sendChatMessage(`❌ Soygun İptal: Yetersiz katılımcı.`);
                if (Math.random() < 0.4) {
                    const share = Math.floor((15000 + Math.random() * 10000) / h.p.length);
                    for (let p of h.p) await db.ref('users/' + p.toLowerCase()).transaction(u => { if (u) u.balance += share; return u; });
                    await sendChatMessage(`💥 BANKA PATLADI! Herkese +${share} 💰 dağıtıldı! 🔥`);
                } else await sendChatMessage(`🚔 POLİS BASKINI! Soygun başarısız. 👮‍♂️`);
            }, 90000);
        } else if (!currentHeist.p.includes(user)) { currentHeist.p.push(user); await sendChatMessage(`@${user} ekibe katıldı!`); }
    }

    // --- SOSYAL & DİĞER KOMUTLAR ---
    else if (lowMsg === '!fal') {
        const list = ["Geleceğin çok parlak!", "Beklediğin haber yakında gelecek.", "Eski bir dostunla karşılaşacaksın.", "Dikkatli ol, nazar var!", "Aşk hayatın hareketlenecek."];
        await sendChatMessage(`🔮 @${user}, Falın: ${list[Math.floor(Math.random() * list.length)]}`);
    }

    else if (lowMsg.startsWith('!ship')) {
        const target = args[0]?.replace('@', '');
        if (!target) return;
        const perc = Math.floor(Math.random() * 101);
        await sendChatMessage(`❤️ @${user} & @${target} Uyumu: %${perc} ${perc > 80 ? '🔥' : perc > 50 ? '😏' : '💔'}`);
    }

    else if (lowMsg === '!zenginler') {
        const snap = await db.ref('users').once('value');
        const sorted = Object.entries(snap.val() || {}).sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0)).slice(0, 5);
        let txt = "🏆 EN ZENGİNLER: ";
        sorted.forEach((u, i) => txt += `${i + 1}. ${u[0]} (${u[1].balance}) | `);
        await sendChatMessage(txt.slice(0, -3));
    }

    else if (lowMsg.startsWith('!hava')) {
        const city = args[0] || "Istanbul";
        try {
            const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${city}&count=1&language=tr&format=json`);
            if (geo.data.results) {
                const { latitude, longitude, name } = geo.data.results[0];
                const weather = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
                await sendChatMessage(`☁️ ${name}: ${weather.data.current_weather.temperature}°C | Rüzgar: ${weather.data.current_weather.windspeed} km/s`);
            } else { await sendChatMessage(`❌ Şehir bulunamadı: ${city}`); }
        } catch (e) { console.log(e); }
    }

    else if (lowMsg === '!söz') {
        const list = ["Mesafe iyidir, kimin nerede durduğunu hatırlatır.", "Zirveye tek başına çıkılır.", "Kurduğun hayali başkası yaşar.", "Giden gitmiştir."];
        await sendChatMessage(`✍️ @${user}: ${list[Math.floor(Math.random() * list.length)]}`);
    }

    else if (lowMsg === '!efkar') {
        const p = Math.floor(Math.random() * 101);
        await sendChatMessage(`🚬 @${user} Efkar Seviyesi: %${p} ${p > 70 ? '😭🚬' : '🍷'}`);
    }

    else if (lowMsg.startsWith('!sustur')) {
        const target = args[0]?.replace('@', '').toLowerCase();
        if (!target) return;
        const snap = await userRef.once('value');
        if ((snap.val()?.balance || 0) < 10000) return await sendChatMessage(`@${user}, 10.000 💰 bakiye lazım!`);

        await userRef.transaction(u => { if (u) u.balance -= 10000; return u; });
        await sendChatMessage(`/timeout ${target} 10`);
        await sendChatMessage(`🔇 @${user}, @${target} kullanıcısını 10 saniye susturdu!`);
    }

    // --- ADMIN / MOD (Tahmin & Piyango) ---
    else if (lowMsg.startsWith('!tahmin')) {
        if (!isAuthorized) return;
        activePrediction = { q: args.join(' '), v1: 0, v2: 0, voters: {} };
        await sendChatMessage(`📊 TAHMİN: ${activePrediction.q} | Oylama: !oyla 1 veya !oyla 2`);
    }
    else if (lowMsg.startsWith('!oyla') && activePrediction) {
        const pick = args[0];
        if (activePrediction.voters[user]) return;
        if (pick === '1') { activePrediction.v1++; activePrediction.voters[user] = '1'; }
        else if (pick === '2') { activePrediction.v2++; activePrediction.voters[user] = '2'; }
        await sendChatMessage(`🗳️ @${user} oy kullandı.`);
    }
    else if (lowMsg.startsWith('!sonuç') && activePrediction) {
        if (!isAuthorized) return;
        await sendChatMessage(`📊 SONUÇ: Seçenek 1: ${activePrediction.v1} oy | Seçenek 2: ${activePrediction.v2} oy.`);
        activePrediction = null;
    }

    else if (lowMsg.startsWith('!piyango')) {
        const sub = args[0];
        if (sub === "başla") {
            if (!isAuthorized) return;
            const cost = parseInt(args[1]) || 500;
            activePiyango = { participants: [], cost, pool: 0 };
            await sendChatMessage(`🎰 PİYANGO BAŞLADI! Ücret: ${cost} 💰 | Katılmak için: !piyango katıl`);
        } else if (sub === "katıl" && activePiyango) {
            if (activePiyango.participants.includes(user.toLowerCase())) return;
            const snap = await userRef.once('value');
            if ((snap.val()?.balance || 0) < activePiyango.cost) return await sendChatMessage(`@${user}, Yetersiz bakiye!`);

            await userRef.transaction(u => { if (u) { u.balance -= activePiyango.cost; } return u; });
            activePiyango.pool += activePiyango.cost;
            activePiyango.participants.push(user.toLowerCase());
            await sendChatMessage(`🎟️ @${user} katıldı! (Havuz: ${activePiyango.pool} 💰)`);
        } else if (sub === "bitir" && activePiyango) {
            if (!isAuthorized) return;
            if (activePiyango.participants.length === 0) { activePiyango = null; return await sendChatMessage(`❌ Piyango boş.`); }
            const winner = activePiyango.participants[Math.floor(Math.random() * activePiyango.participants.length)];
            const prize = activePiyango.pool;
            await db.ref('users/' + winner).transaction(u => { if (u) u.balance += prize; return u; });
            await sendChatMessage(`🎉 TALİHLİ: @${winner}! Tam ${prize} 💰 kazandı! 🎊`); activePiyango = null;
        }
    }

    else if (lowMsg === '!komutlar') {
        await sendChatMessage(`🎮 !slot, !yazitura, !kutu, !soygun, !duello | 💰 !bakiye, !günlük, !zenginler | 🔮 !fal, !ship, !efkar, !hava`);
    }
});

// ---------------------------------------------------------
// 5. ADMIN PANEL & API
// ---------------------------------------------------------
const ADMIN_KEY = process.env.ADMIN_KEY || "Aloske123!"; // Render üzerinden ADMIN_KEY ayarla

// Admin Sayfası
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });

// Güvenlik Middleware
const authAdmin = (req, res, next) => {
    const key = req.headers['authorization'] || req.body.key;
    if (key === ADMIN_KEY) return next();
    res.status(403).json({ success: false, error: 'Yetkisiz Erişim' });
};

app.post('/admin-api/check', authAdmin, (req, res) => res.json({ success: true }));

app.get('/admin-api/stats', authAdmin, async (req, res) => {
    const tokens = (await db.ref('bot_tokens').once('value')).val();
    const users = (await db.ref('users').once('value')).val() || {};
    res.json({
        broadcaster: tokens?.bot_username || "Bağlı Değil",
        userCount: Object.keys(users).length
    });
});

app.post('/admin-api/send', authAdmin, async (req, res) => {
    await sendChatMessage(req.body.msg);
    res.json({ success: true });
});

app.get('/admin-api/user/:name', authAdmin, async (req, res) => {
    const snap = await db.ref('users/' + req.params.name.toLowerCase()).once('value');
    if (snap.exists()) res.json({ found: true, balance: snap.val().balance || 0 });
    else res.json({ found: false });
});

app.post('/admin-api/update-user', authAdmin, async (req, res) => {
    const { user, balance } = req.body;
    await db.ref('users/' + user.toLowerCase()).update({ balance: parseInt(balance) });
    res.json({ success: true });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'shop.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MASTER FINAL AKTIF!`));
