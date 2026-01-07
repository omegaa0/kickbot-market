const fs = require('fs');
const path = 'c:/Users/Mehmet/Desktop/KickChatBot/server.js';
let content = fs.readFileSync(path, 'utf8');

const startMark = "else if (lowMsg.startsWith('!doğrulama') || lowMsg.startsWith('!dogrulama') || lowMsg.startsWith('!kod')) {";
const endMark = "// TAHMİN";

const startIndex = content.indexOf(startMark);
const endIndex = content.indexOf(endMark);

if (startIndex === -1 || endIndex === -1) {
    console.log(`Error: Marks not found. Start: ${startIndex}, End: ${endIndex}`);
    process.exit(1);
}

// Find the parent block closing brace before // TAHMİN
// The block ends with a } followed by some whitespace/newlines
const blockEndIndex = content.lastIndexOf('}', endIndex);

const newBlock = `else if (/^!(do[gğ]rulama|kod)/i.test(lowMsg)) {
                const inputCode = args[0]?.trim();
                if (!inputCode) return await reply(\`@\${user}, Lütfen mağazadaki 6 haneli kodu yazın. Örn: !doğrulama 123456\`);

                console.log(\`[Auth-Ultra] İstek: User="\${user}" | Kod="\${inputCode}"\`);

                const cleanUser = user.toLowerCase().trim();
                let foundMatch = null;

                // Nesne ({code: "..."}) veya direkt string ("...") kontrolü
                const getCode = (d) => (typeof d === 'object' && d !== null) ? (d.code || d.auth_code) : d;

                // 1. ADIM: Doğrudan kullanıcı adı ile sorgula
                const pendingSnap = await db.ref('pending_auth/' + cleanUser).once('value');
                const pending = pendingSnap.val();

                if (pending && String(getCode(pending)).trim() === String(inputCode)) {
                    foundMatch = { username: cleanUser, data: pending };
                } 
                
                // 2. ADIM: Smart Match (Havuzda Ara)
                if (!foundMatch) {
                    const allPendingSnap = await db.ref('pending_auth').once('value');
                    const allPending = allPendingSnap.val() || {};
                    
                    const matches = Object.entries(allPending).filter(([u, d]) => String(getCode(d)).trim() === String(inputCode));
                    
                    if (matches.length === 1) {
                        const [matchedUser, matchedData] = matches[0];
                        foundMatch = { username: matchedUser, data: matchedData, isSmart: true };
                        console.log(\`[Auth-Ultra] ✅ Akıllı eşleşme bulundu: \${matchedUser}\`);
                    } else if (matches.length > 1) {
                        return await reply(\`❌ @\${user}, Girilen kod birden fazla hesapla çakışıyor! Lütfen yeni kod al.\`);
                    }
                }

                // SONUÇ DEĞERLENDİRME
                if (foundMatch) {
                    const { username: targetUser, data, isSmart } = foundMatch;
                    const ts = (typeof data === 'object' && data !== null) ? (data.timestamp || 0) : 0;
                    const isExpired = ts > 0 && (Date.now() - ts > 1800000); // 30 Dakika
                    
                    if (isExpired) {
                        return await reply(\`❌ @\${user}, Kodun süresi dolmuş. Mağazadan yeni bir kod almalısın.\`);
                    }

                    console.log(\`[Auth] ✅ Başarılı: \${targetUser}\`);
                    
                    await db.ref('users/' + targetUser).update({ 
                        auth_channel: broadcasterId,
                        last_auth_at: Date.now(),
                        kick_name: user 
                    });
                    
                    await db.ref('auth_success/' + targetUser).set(true);
                    await db.ref('pending_auth/' + targetUser).remove();

                    const extra = isSmart ? " (İsim otomatik düzeltildi)" : "";
                    await reply(\`✅ @\${user}, Kimliğin başarıyla doğrulandı! Mağaza sayfasına artık dönebilirsin.\${extra} 🛍️\`);
                } else {
                    console.log(\`[Auth] ❌ Eşleşme Yok. Girilen: \${inputCode}\`);
                    await reply(\`❌ @\${user}, Kod yanlış! Lütfen mağaza sayfasındaki kodu doğru yazdığından emin ol.\`);
                }
            }

            // MASTER ADMIN: TEMİZLE
            else if (lowMsg === '!auth-temizle' && user.toLowerCase() === 'omegacyr') {
                await db.ref('pending_auth').remove();
                await reply(\`🧹 @\${user}, Bekleyen tüm doğrulama istekleri temizlendi.\`);
            }
`;

// Replace from startIndex to blockEndIndex + 1 (the closing brace)
const before = content.substring(0, startIndex);
const after = content.substring(blockEndIndex + 1);

fs.writeFileSync(path, before + newBlock + after, 'utf8');
console.log("Successfully patched server.js");
