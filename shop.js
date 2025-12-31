// shop.js - Dynamic Based on Auth Channel
const firebaseConfig = {
    apiKey: "AIzaSyCfAiqV9H8I8pyusMyDyxSbjJ6a3unQaR8",
    authDomain: "kickbot-market.firebaseapp.com",
    databaseURL: "https://kickbot-market-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "kickbot-market",
    storageBucket: "kickbot-market.firebasestorage.app",
    messagingSenderId: "301464297024",
    appId: "1:301464297024:web:7cdf849aa950b8ba0649a5"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let currentChannelId = null;

const authContainer = document.getElementById('auth-container');
const mainContent = document.getElementById('main-content');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const usernameInput = document.getElementById('username-input');
const codeDisplay = document.getElementById('auth-code');
const cmdExample = document.getElementById('cmd-example');
const marketGrid = document.getElementById('market-items');
const toast = document.getElementById('toast');
const channelBadge = document.getElementById('channel-badge');

function init() {
    const savedUser = localStorage.getItem('kickbot_user');
    if (savedUser) { login(savedUser); } else { showAuth(); }
    document.getElementById('generate-code-btn').addEventListener('click', startAuth);
    document.getElementById('back-btn').addEventListener('click', showAuth);
    document.getElementById('logout-btn').addEventListener('click', logout);
}

function showAuth() {
    authContainer.classList.remove('hidden');
    mainContent.classList.add('hidden');
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    db.ref('pending_auth').off();
}

function startAuth() {
    const user = usernameInput.value.toLowerCase().trim();
    if (user.length < 3) return showToast("Geçersiz kullanıcı adı!", "error");
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db.ref('pending_auth/' + user).set({ code, timestamp: Date.now() }).then(() => {
        codeDisplay.innerText = code;
        cmdExample.innerText = `!doğrulama ${code}`;
        step1.classList.add('hidden');
        step2.classList.remove('hidden');
        db.ref('auth_success/' + user).on('value', (snap) => {
            if (snap.val()) { db.ref('auth_success/' + user).remove(); login(user); }
        });
    });
}

function login(user) {
    currentUser = user;
    localStorage.setItem('kickbot_user', user);
    authContainer.classList.add('hidden');
    mainContent.classList.remove('hidden');
    document.getElementById('display-name').innerText = user.toUpperCase();
    document.getElementById('hero-name').innerText = user.toUpperCase();
    document.getElementById('user-avatar').innerText = user[0].toUpperCase();

    db.ref('users/' + user).on('value', (snap) => {
        const data = snap.val() || { balance: 0, auth_channel: null };
        document.getElementById('user-balance').innerText = `${(data.balance || 0).toLocaleString()} 💰`;
        if (data.auth_channel && data.auth_channel !== currentChannelId) {
            currentChannelId = data.auth_channel;
            loadChannelMarket(currentChannelId);
        } else if (!data.auth_channel) {
            document.getElementById('no-channel-msg').classList.remove('hidden');
            marketGrid.innerHTML = "";
            channelBadge.classList.add('hidden');
            document.getElementById('market-status').innerText = "Market ürünlerini görmek için herhangi bir kanalda !doğrulama yapmalısın.";
        }
    });
}

async function loadChannelMarket(channelId) {
    document.getElementById('no-channel-msg').classList.add('hidden');
    channelBadge.classList.remove('hidden');
    const snap = await db.ref('channels/' + channelId).once('value');
    const channelData = snap.val() || {};
    const settings = channelData.settings || {};
    const sounds = settings.custom_sounds || {};
    document.getElementById('chan-name').innerText = (channelData.username || "Kick Kanalı") + " (Doğrulandı)";
    document.getElementById('chan-icon').innerText = (channelData.username || "K")[0].toUpperCase();
    document.getElementById('market-status').innerText = `${channelData.username || 'Kanal'} market ürünleri yönetiliyor.`;
    marketGrid.innerHTML = "";

    // 1. MUTE (Sustur)
    const muteCost = settings.mute_cost || 10000;
    renderItem("🚫 Kullanıcı Sustur", "Hedeflenen kişiyi 10 dakika boyunca susturur.", muteCost, "mute");

    // 2. TTS
    const ttsCost = settings.tts_cost || 2500;
    renderItem("🎙️ TTS (Sesli Mesaj)", "Mesajınızı yayında seslendirir.", ttsCost, "tts");

    // 3. SOUNDS
    Object.entries(sounds).forEach(([name, data]) => {
        renderItem(`🎵 Ses: !ses ${name}`, "Kanalda özel ses efekti çalar.", data.cost, "sound", name);
    });
}

function renderItem(name, desc, price, type, trigger = "") {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
        <div class="item-icon">${type === 'tts' ? '🎙️' : (type === 'mute' ? '🚫' : '🎵')}</div>
        <h3>${name}</h3>
        <p>${desc}</p>
        <span class="price-tag">${parseInt(price).toLocaleString()} 💰</span>
        <button class="buy-btn" onclick="executePurchase('${type}', '${trigger}', ${price})">Hemen Uygula</button>
    `;
    marketGrid.appendChild(card);
}

async function executePurchase(type, trigger, price) {
    if (!currentUser || !currentChannelId) return;
    const userSnap = await db.ref('users/' + currentUser).once('value');
    const userData = userSnap.val() || { balance: 0 };
    const isInf = userData.is_infinite;
    if (!isInf && (userData.balance || 0) < price) { return showToast("Bakiye yetersiz! ❌", "error"); }

    let userInput = "";
    if (type === 'tts') {
        userInput = prompt("Mesajınızı girin:");
        if (!userInput) return;
    } else if (type === 'mute') {
        userInput = prompt("Susturulacak kullanıcının adını girin (Örn: aloske):");
        if (!userInput) return;
        userInput = userInput.replace('@', '').toLowerCase().trim();
    } else {
        if (!confirm(`"${trigger}" sesi çalınsın mı?`)) return;
    }

    if (!isInf) {
        await db.ref('users/' + currentUser).transaction(u => { if (u) u.balance -= price; return u; });
    }

    if (type === 'tts') {
        await db.ref(`channels/${currentChannelId}/stream_events/tts`).push({
            text: `@${currentUser} (Market) diyor ki: ${userInput}`,
            played: false, timestamp: Date.now(), broadcasterId: currentChannelId
        });
    } else if (type === 'sound') {
        const snap = await db.ref(`channels/${currentChannelId}/settings/custom_sounds/${trigger}`).once('value');
        const sound = snap.val();
        if (sound) {
            await db.ref(`channels/${currentChannelId}/stream_events/sound`).push({
                soundId: trigger, url: sound.url, volume: sound.volume || 100, duration: sound.duration || 0,
                played: false, timestamp: Date.now(), broadcasterId: currentChannelId
            });
        }
    } else if (type === 'mute') {
        // We push a "mute_event" that the server logic (already in server.js but we trigger it here)
        // Since timeoutUser is server-side, we should probably handle this via a dedicated event or API.
        // For simplicity, let's just use the existing chat-like trigger if possible, or push a specific event.
        await db.ref(`channels/${currentChannelId}/stream_events/mute`).push({
            user: currentUser,
            target: userInput,
            timestamp: Date.now(),
            broadcasterId: currentChannelId
        });
        // We additionally increment target's ban count
        await db.ref(`users/${userInput}/bans/${currentChannelId}`).transaction(c => (c || 0) + 1);
    }
    showToast("İşlem Başarılı! 🚀", "success");
}

function logout() { localStorage.removeItem('kickbot_user'); location.reload(); }
function showToast(msg, type) {
    toast.innerText = msg; toast.className = `toast ${type}`; toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}
init();
