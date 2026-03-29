const axios = require('axios');
require('dotenv').config();

async function syncToSheets(data) {
    const url = process.env.GOOGLE_SCRIPT_URL;
    if (!url) {
        console.error('❌ Google Script URL not found in .env');
        return;
    }

    try {
        const response = await axios.post(url, data);
        if (response.status === 200) {
            console.log('✅ Berhasil sinkronisasi ke Google Sheets');
        } else {
            console.error('⚠️ Gagal sinkronisasi ke Google Sheets:', response.statusText);
        }
    } catch (error) {
        console.error('❌ Error sinkronisasi ke Google Sheets:', error.message);
    }
}

module.exports = { syncToSheets };
