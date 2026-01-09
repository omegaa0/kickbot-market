const axios = require('axios');
const fs = require('fs');
const path = require('path');

const url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Turkey_provinces_blank_map.svg/1024px-Turkey_provinces_blank_map.svg.png';
const dest = path.join(__dirname, 'turkey_map.png');

async function downloadImage() {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (e) {
        console.error("Download failed:", e.message);
    }
}

downloadImage().then(() => console.log("Done."));
