const firebase = require('firebase/compat/app');
require('firebase/compat/database');
require('dotenv').config({ path: 'c:/Users/Mehmet/Desktop/KickChatBot/.env' });

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    databaseURL: process.env.FIREBASE_DB_URL
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

async function testRules() {
    console.log("🔥 TESTING FIREBASE RULES FOR 'omegacyr' 🔥");
    const testCode = "TEST_" + Math.floor(Math.random() * 1000);

    try {
        console.log(`Attempting to write to 'pending_auth/omegacyr'...`);
        await db.ref('pending_auth/omegacyr').set({
            code: testCode,
            timestamp: Date.now(),
            rules_test: true
        });
        console.log("✅ WRITE SUCCESS! Rules allow writing to 'pending_auth/omegacyr'.");

        console.log("Attempting to read back...");
        const snap = await db.ref('pending_auth/omegacyr').once('value');
        const val = snap.val();

        if (val && val.code === testCode) {
            console.log("✅ READ VERIFIED! Data matches:", val);
        } else {
            console.error("❌ READ MISMATCH! Got:", val);
        }
    } catch (error) {
        console.error("❌ WRITE FAILED! Permission Denied or Network Error.");
        console.error("Error Details:", error.message);
    }
    process.exit(0);
}

testRules();
