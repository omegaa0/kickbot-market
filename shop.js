// shop.js - KickBot Market & Firebase Sync

const firebaseConfig = {
    apiKey: "AIzaSyCfAiqV9H8I8pyusMyDyxSbjJ6a3unQaR8",
    authDomain: "kickbot-market.firebaseapp.com",
    databaseURL: "https://kickbot-market-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "kickbot-market",
    storageBucket: "kickbot-market.firebasestorage.app",
    messagingSenderId: "301464297024",
    appId: "1:301464297024:web:7cdf849aa950b8ba0649a5"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let currentUser = null;
let currentCode = null;

const items = [
    { id: 'shield', name: 'Dokunulmazlık Kalkanı', desc: '1 saat boyunca !sustur komutlarından korunursun.', price: 50000, icon: '🛡️' },
    { id: 'xp_boost', name: 'XP Dopingi', desc: 'Sohbet seviyen 2 kat daha hızlı artar (24 Saat).', price: 25000, icon: '⚡' },
    { id: 'royal_title', name: 'Kral Ünvanı', desc: 'Bot isminin yanına efsanevi [KRAL] unvanını ekler.', price: 100000, icon: '👑' },
    { id: 'luck_charm', name: 'Şans Tılsımı', desc: 'Kumar oyunlarında şansını %5 artırır.', price: 75000, icon: '🍀' },
    { id: 'color_pick', name: 'İsim Rengi', desc: 'Botun senin için verdiği cevaplardaki emojiyi seç.', price: 15000, icon: '🎨' },
    { id: 'heist_gear', name: 'Soygun Kitli', desc: 'Soygunlardaki payını %10 artırır.', price: 40000, icon: '🕵️' }
];

// Elementler
const authContainer = document.getElementById('auth-container');
const mainContent = document.getElementById('main-content');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const usernameInput = document.getElementById('username-input');
const codeDisplay = document.getElementById('auth-code');
const cmdExample = document.getElementById('cmd-example');
const marketGrid = document.querySelector('.market-grid');
const toast = document.getElementById('toast');

// Uygulama Başlatma
function init() {
    const savedUser = localStorage.getItem('kickbot_user');
    if (savedUser) {
        login(savedUser);
    } else {
        showAuth();
    }

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

    currentUser = user;
    currentCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Firebase'e bekleme kaydı at
    db.ref('pending_auth/' + user).set({
        code: currentCode,
        timestamp: Date.now()
    }).then(() => {
        codeDisplay.innerText = currentCode;
        cmdExample.innerText = `!doğrulama ${currentCode}`;
        step1.classList.add('hidden');
        step2.classList.remove('hidden');

        // Firebase'den onay gelmesini bekle
        db.ref('auth_success/' + user).on('value', (snapshot) => {
            if (snapshot.val()) {
                db.ref('auth_success/' + user).remove();
                db.ref('pending_auth/' + user).remove();
                login(user);
            }
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

    // Bakiyeyi Firebase'den canlı dinle
    db.ref('users/' + user).on('value', (snapshot) => {
        const data = snapshot.val() || { balance: 0 };
        document.getElementById('user-balance').innerText = `${data.balance.toLocaleString()} 💰`;
    });

    loadMarket();
}

function loadMarket() {
    marketGrid.innerHTML = "";
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.innerHTML = `
            <div class="item-icon">${item.icon}</div>
            <h3>${item.name}</h3>
            <p>${item.desc}</p>
            <span class="price-tag">${item.price.toLocaleString()} 💰</span>
            <button class="buy-btn" data-id="${item.id}" data-price="${item.price}">Satın Al</button>
        `;
        marketGrid.appendChild(card);
    });

    document.querySelectorAll('.buy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => buyItem(e.target.dataset.id, parseInt(e.target.dataset.price)));
    });
}

function buyItem(id, price) {
    db.ref('users/' + currentUser).once('value').then((snapshot) => {
        const data = snapshot.val() || { balance: 0 };
        if (data.balance < price) return showToast("Bakiye yetersiz! ❌", "error");

        data.balance -= price;
        // Opsiyonel: Satın alınan eşyayı envantere ekle
        if (!data.inventory) data.inventory = [];
        data.inventory.push({ id, date: Date.now() });

        db.ref('users/' + currentUser).set(data).then(() => {
            showToast("Satın alma başarılı! 🎉", "success");
        });
    });
}

function logout() {
    localStorage.removeItem('kickbot_user');
    location.reload();
}

function showToast(msg, type) {
    toast.innerText = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

init();
