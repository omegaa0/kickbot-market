const firebase = require('firebase/compat/app');
require('firebase/compat/database');
require('dotenv').config({ path: 'c:/Users/Mehmet/Desktop/KickChatBot/.env' });

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    databaseURL: process.env.FIREBASE_DB_URL
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

async function diagnose() {
    console.log("--- DIAGNOSTICS START ---");

    // 1. Check pending_auth for omegacyr
    console.log("Checking pending_auth/omegacyr...");
    const snap = await db.ref('pending_auth/omegacyr').once('value');
    const val = snap.val();

    if (val) {
        console.log("DATA FOUND:", val);
        const code = (typeof val === 'object' && val !== null) ? (val.code || val.auth_code) : val;
        console.log("Extracted Code:", code);
        console.log("Type of Code:", typeof code);
    } else {
        console.log("NO DATA FOUND for omegacyr in pending_auth");
    }

    // 2. Dump all pending keys to see if there's a weird casing version
    const all = await db.ref('pending_auth').once('value');
    const allVal = all.val() || {};
    console.log("All Pending Keys:", Object.keys(allVal));

    // 3. User info
    console.log("Checking users/omegacyr...");
    const uSnap = await db.ref('users/omegacyr').once('value');
    console.log("User Data:", uSnap.val());

    console.log("--- DIAGNOSTICS END ---");
    process.exit(0);
}

diagnose();
