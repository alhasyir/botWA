require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const MessagingResponse = twilio.twiml.MessagingResponse;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// Fungsi delay agar chatbot terasa natural
// ─────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────
// Fungsi untuk menentukan balasan chatbot
// ─────────────────────────────────────────
function getReply(message) {
  const msg = message.trim().toLowerCase();

  // Menu utama
  if (['halo', 'hai', 'menu', 'hi', 'hello'].includes(msg)) {
    return (
      'Halo 😊 Selamat datang di *Klinik Gigi Sehat Sentosa*.\n\n' +
      'Silakan pilih layanan:\n' +
      '1. Info layanan\n' +
      '2. Harga perawatan\n' +
      '3. Booking jadwal\n' +
      '4. Lokasi klinik'
    );
  }

  // Pilihan 1: Info layanan
  if (msg === '1') {
    return (
      'Kami menyediakan layanan:\n' +
      '- Scaling (pembersihan karang gigi)\n' +
      '- Tambal gigi\n' +
      '- Cabut gigi\n' +
      '- Bleaching gigi'
    );
  }

  // Pilihan 2: Harga perawatan
  if (msg === '2') {
    return (
      'Estimasi harga:\n' +
      '💎 Scaling: mulai 150rb\n' +
      '💎 Tambal gigi: mulai 200rb\n' +
      '💎 Cabut gigi: mulai 300rb\n' +
      '💎 Bleaching: mulai 800rb'
    );
  }

  // Pilihan 3: Booking jadwal
  if (msg === '3') {
    return (
      'Silakan kirim format berikut untuk booking:\n\n' +
      '*Nama:*\n' +
      '*Tanggal:*\n' +
      '*Jam:*\n\n' +
      'Admin akan mengonfirmasi jadwal Anda. 📅'
    );
  }

  // Pilihan 4: Lokasi klinik
  if (msg === '4') {
    return (
      '📍 Lokasi kami:\n' +
      'Jl. Contoh No.10 Bandung\n' +
      'Google Maps: https://maps.google.com'
    );
  }

  // Default response
  return (
    'Maaf kak, silakan pilih menu berikut:\n' +
    '1. Info layanan\n' +
    '2. Harga perawatan\n' +
    '3. Booking jadwal\n' +
    '4. Lokasi klinik'
  );
}

// ─────────────────────────────────────────
// Webhook endpoint POST /webhook
// ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || 'Unknown';

  // Logging pesan masuk
  console.log('─────────────────────────────────');
  console.log(`📩 Pesan masuk dari : ${from}`);
  console.log(`💬 Isi pesan        : ${incomingMsg}`);
  console.log(`⏰ Waktu            : ${new Date().toLocaleString('id-ID')}`);
  console.log('─────────────────────────────────');

  // Delay 1–2 detik agar terasa natural
  const delayMs = Math.floor(Math.random() * 1000) + 1000; // antara 1000–2000 ms
  await delay(delayMs);

  // Buat balasan
  const replyText = getReply(incomingMsg);

  const twiml = new MessagingResponse();
  twiml.message(replyText);

  console.log(`✅ Membalas ke ${from}: "${replyText.substring(0, 60)}..."`);

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ─────────────────────────────────────────
// Root endpoint untuk cek status server
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('✅ WhatsApp Chatbot Klinik Gigi Sehat Sentosa – Server aktif!');
});

// ─────────────────────────────────────────
// Jalankan server
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  🦷 Chatbot Klinik Gigi Sehat Sentosa  ║');
  console.log(`║  🚀 Server berjalan di port ${PORT}       ║`);
  console.log('╚══════════════════════════════════════╝');
});
