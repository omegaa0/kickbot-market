const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Statik dosyaları sun (html, css, js)
app.use(express.static(path.join(__dirname)));

// Tüm istekleri shop.html'e yönlendir
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'shop.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
