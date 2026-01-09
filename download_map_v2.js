const axios = require('axios');
const fs = require('fs');
const path = require('path');

const url = 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Turkey_provinces_blank_map.svg';
const dest = path.join(__dirname, 'turkey_map_local.svg');

async function downloadMap() {
    console.log("Downloading map...");
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://en.wikipedia.org/'
            }
        });

        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log("Map downloaded successfully to " + dest);
                resolve();
            });
            writer.on('error', (err) => {
                console.error("Writer error:", err);
                reject(err);
            });
        });
    } catch (e) {
        console.error("Download failed:", e.message);
        if (e.response) console.error("Status:", e.response.status);
    }
}

downloadMap();
