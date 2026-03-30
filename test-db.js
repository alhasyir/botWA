const { Client } = require('pg');
require('dotenv').config();

async function testConnection() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: true
    });

    try {
        console.log('🚀 Menghubungkan ke database...');
        await client.connect();
        const res = await client.query('SELECT current_database(), current_user');
        console.log('✅ KONEKSI BERHASIL!');
        console.log('Database:', res.rows[0].current_database);
        console.log('User:', res.rows[0].current_user);
    } catch (err) {
        console.error('❌ GAGAL MASUK:', err.message);
        if (err.message.includes('password authentication failed')) {
            console.log('💡 Penyebab: Password atau Username salah!');
        } else if (err.message.includes('ECONNREFUSED')) {
            console.log('💡 Penyebab: Port atau Host tidak dapat dijangkau!');
        }
    } finally {
        await client.end();
    }
}

testConnection();
