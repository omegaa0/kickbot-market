const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Alternatif güvenilir kaynak (Simplemas)
const url = 'https://raw.githubusercontent.com/cihadturhan/turkey-map/master/images/turkey-map.svg';
const dest = path.join(__dirname, 'turkey_map_local.svg');

async function downloadMap() {
    console.log("Downloading map from GitHub Raw...");
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log("SUCCESS: Map downloaded to " + dest);
                resolve();
            });
            writer.on('error', (err) => {
                console.error("Writer error:", err);
                reject(err);
            });
        });
    } catch (e) {
        console.error("Download failed:", e.message);
    }
}

downloadMap();
