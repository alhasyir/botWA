const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { syncToSheets } = require('./sync_sheets');
require('dotenv').config();

// ─────────────────────────────────────────
// Inisialisasi Express & Socket.io
// ─────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static('public'));

// ─────────────────────────────────────────
// Variabel Global
// ─────────────────────────────────────────
let client;
let botStatus = 'Terputus';
const RESERVATIONS_FILE = path.join(__dirname, 'reservations.json');

// ─────────────────────────────────────────
// Fungsi Helper
// ─────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveReservation(data) {
  try {
    let reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    reservations.push({
      id: Date.now().toString() + Math.round(Math.random() * 1000).toString(),
      ...data,
      status: 'Dipesan'
    });
    fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2));
    io.emit('reservations', reservations);
    
    // Sync to Google Sheets
    syncToSheets({
        timestamp: data.timestamp,
        nama: data.nama,
        umur: data.umur,
        alamat: data.alamat,
        keluhan: data.keluhan,
        dokter: data.dokter,
        tanggal: data.tanggal,
        jam: data.jam,
        wa: data.wa,
        status: 'Dipesan'
    });
  } catch (error) {
    console.error('❌ Gagal simpan:', error);
  }
}

function parseTimeToMinutes(timeStr) {
  // Mencari format HH:mm atau HH.mm (misal: 10:30 atau 10.30)
  const match = timeStr.match(/(\d{1,2})[:.](\d{2})/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return null;
}

function isSlotTaken(tanggal, jam) {
  try {
    if (!fs.existsSync(RESERVATIONS_FILE)) return false;
    const reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const newMinutes = parseTimeToMinutes(jam);
    
    if (newMinutes === null) {
      return reservations.some(r => 
        r.tanggal.trim().toLowerCase() === tanggal.trim().toLowerCase() && 
        r.jam.trim().toLowerCase() === jam.trim().toLowerCase()
      );
    }

    return reservations.some(r => {
      if (r.tanggal.trim().toLowerCase() !== tanggal.trim().toLowerCase()) return false;
      const existingMinutes = parseTimeToMinutes(r.jam);
      if (existingMinutes === null) return false;
      return Math.abs(newMinutes - existingMinutes) < 30;
    });
  } catch (e) {
    console.error('❌ Error checking slot:', e);
    return false;
  }
}

function formatRekap(targetDay) {
  try {
    const reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const filtered = reservations.filter(r => 
      r.tanggal.toLowerCase().includes(targetDay.toLowerCase())
    );

    if (filtered.length === 0) return `❌ Belum ada antrian untuk hari *${targetDay}*.`;

    let rekap = `📝 *REKAP ANTRIAN PASIEN*\n📅 *${targetDay}*\n\n`;
    const byDoctor = {};
    filtered.forEach(r => {
      const dr = r.dokter || 'Belum Memilih Dokter';
      if (!byDoctor[dr]) byDoctor[dr] = [];
      byDoctor[dr].push(r);
    });

    for (const dr in byDoctor) {
      rekap += `*${dr}*\n`;
      byDoctor[dr].sort((a, b) => (parseTimeToMinutes(a.jam) || 0) - (parseTimeToMinutes(b.jam) || 0));
      byDoctor[dr].forEach(r => {
        rekap += `${r.jam}: ${r.nama}/${r.umur || '-'}/${r.alamat || '-'}/${r.keluhan || '-'}/${r.status || '-'}\n`;
      });
      rekap += `---\n\n`;
    }
    return rekap;
  } catch (e) {
    return '❌ Gagal menghasilkan rekap.';
  }
}

function getTakenSlots(dayName) {
  try {
    if (!fs.existsSync(RESERVATIONS_FILE)) return null;
    const reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const taken = [...new Set(reservations
      .filter(r => r.tanggal && r.tanggal.toLowerCase().includes(dayName.toLowerCase()))
      .map(r => r.jam)
    )].sort((a, b) => (parseTimeToMinutes(a) || 0) - (parseTimeToMinutes(b) || 0));
    
    return taken.length > 0 ? taken.join(', ') : null;
  } catch (e) {
    return null;
  }
}

function updateStatus(status) {
  botStatus = status;
  io.emit('status', status);
  console.log(`📡 Status: ${status}`);
}

// ─────────────────────────────────────────
// Logika Inti Bot
// ─────────────────────────────────────────
function initializeBot() {
  if (client) return;

  updateStatus('Menghubungkan...');

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'klinik-gigi-bot' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', (qr) => {
    const qr_svg = qrImage.imageSync(qr, { type: 'svg' });
    const base64 = `data:image/svg+xml;base64,${Buffer.from(qr_svg).toString('base64')}`;
    io.emit('qr', base64);
    qrcodeTerminal.generate(qr, { small: true });
    updateStatus('Menunggu Scan QR');
  });

  client.on('ready', () => {
    updateStatus('Online');
  });

  client.on('authenticated', () => {
    console.log('🔐 Terautentikasi');
  });

  client.on('disconnected', (reason) => {
    updateStatus('Terputus');
    client = null;
  });

  client.on('message', async (message) => {
    if (message.isGroupMsg) return;
    const from = message.from;
    const body = message.body;

    // Command Rekap (Admin)
    if (body.startsWith('!rekap')) {
      const targetDay = body.split(' ')[1] || new Date().toLocaleDateString('id-ID', { weekday: 'long' });
      const rekap = formatRekap(targetDay);
      await message.reply(rekap);
      return;
    }

    // Logic Reservasi
    if (body.includes('PENDAFTARAN PASIEN')) {
      const lines = body.split('\n');
      const data = {};
      lines.forEach(line => {
        const cleanLine = line.replace(/\*/g, '');
        if (cleanLine.includes('NIK')) data.nik = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Nama Lengkap')) data.nama = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Umur')) data.umur = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Tempat, Tanggal Lahir')) data.ttl = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Jenis Kelamin')) data.gender = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Alamat Lengkap')) data.alamat = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Keluhan/Perawatan')) data.keluhan = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Pasien Lama/Baru')) data.status = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Pilihan Dokter')) data.dokter = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Hari/Tanggal')) data.tanggal = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Jam kunjungan')) data.jam = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('No Whatsapp')) data.wa = cleanLine.split(':')[1]?.trim() || '';
      });

      if (data.nama && data.tanggal && data.jam) {
        // Cek apakah slot sudah terisi (30 menit interval)
        if (isSlotTaken(data.tanggal, data.jam)) {
          await message.reply(
            '⚠️ *Jadwal Tidak Tersedia/Bentrok*\n\n' +
            'Mohon maaf, jadwal pada hari *' + data.tanggal + '* di sekitar jam *' + data.jam + '* sudah terisi atau terlalu berdekatan dengan pasien lain (estimasi 30 menit per pasien).\n\n' +
            'Silakan pilih waktu lain yang selisihnya minimal 30 menit dari jadwal yang sudah ada. Terima kasih. 🙏'
          );
          return;
        }

        saveReservation({ ...data, from, timestamp: new Date().toLocaleString('id-ID') });
        await message.react('✅');
        
        // Labeling Otomatis (Hanya untuk WA Business)
        try {
          const chat = await message.getChat();
          const labels = await client.getLabels();
          const targetLabel = labels.find(l => l.name.toLowerCase().includes('reservasi'));
          if (targetLabel) {
            await chat.changeLabels([targetLabel.id]);
          }
        } catch (labelError) {
          console.log('🏷️ Info: Fitur label tidak aktif/bukan akun bisnis.');
        }

        await message.reply(
          '✅ *Reservasi Telah Kami Terima!*\n\n' +
          'Terima kasih, Bapak/Ibu *' + data.nama + '*. Data pendaftaran Anda telah tercatat di sistem kami.\n\n' +
          'Admin kami akan segera menghubungi Anda untuk konfirmasi final jadwal. Terima kasih.\n\n' +
          '_Klinik Gigi Tobi - Melayani dengan Sepenuh Hati._'
        );
        return;
      }
    }

    // Balasan Menu Biasa
    const reply = getReply(body);
    await message.reply(reply);
  });

  client.initialize().catch(err => {
    console.error('❌ Gagal init:', err);
    updateStatus('Error');
  });
}

const SCHEDULE = {
  "senin": [
    { "jam": "10.00 - 13.00", "dokter": ["drg. Andhika Surya", "drg. Adillah Faridh"] },
    { "jam": "16.00 - 18.00", "dokter": ["drg. Tiara Edyatami"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Andhika Surya"] }
  ],
  "selasa": [
    { "jam": "10.00 - 13.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"] },
    { "jam": "14.00 - 16.00", "dokter": ["drg. Muhammad Habilludin", "drg. Willy Bernadi Sp.BM"] },
    { "jam": "16.00 - 18.00", "dokter": ["drg. Riski Yunika"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"] }
  ],
  "rabu": [
    { "jam": "10.00 - 13.00", "dokter": ["drg. Muhammad Habilludin"] },
    { "jam": "16.00 - 18.00", "dokter": ["drg. Riski Yunika", "drg. Muhammad Habilludin"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Andhika Surya", "drg. Muhammad Habilludin"] }
  ],
  "kamis": [
    { "jam": "10.00 - 13.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"] },
    { "jam": "14.00 - 16.00", "dokter": ["drg. Muhammad Habilludin", "drg. Willy Bernadi Sp.BM"] },
    { "jam": "16.00 - 18.00", "dokter": ["drg. Riski Yunika"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Adillah Faridh", "drg. Muhammad Habilludin"] }
  ],
  "jumat": [
    { "jam": "08.00 - 11.00", "dokter": ["drg. Muhammad Habilludin"] },
    { "jam": "14.00 - 16.00", "dokter": ["drg. Muhammad Habilludin", "drg. Willy Bernadi Sp.BM"] },
    { "jam": "16.00 - 18.00", "dokter": ["drg. Tiara Edyatami"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Andhika Surya", "drg. Muhammad Habilludin"] }
  ],
  "sabtu": [
    { "jam": "10.00 - 14.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"] },
    { "jam": "19.30 - 21.00", "dokter": ["drg. Andhika Surya"] }
  ],
  "minggu": [
    { "jam": "13.00 - 21.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"], "keterangan": "tentatif" }
  ]
};

function getReply(msg) {
  const m = msg.toLowerCase();
  
  if (['halo', 'menu', 'hi', 'start', 'pilih', 'hello'].some(word => m.includes(word))) {
    return (
      '✨ *Selamat Datang di Layanan Digital Klinik Gigi Tobi* ✨\n\n' +
      'Halo! Terima kasih telah menghubungi kami. Kami siap membantu Anda mendapatkan senyum terbaik. 😁\n\n' +
      'Silakan pilih layanan kami dengan membalas pesan ini menggunakan *angka*:\n' +
      '1️⃣ *Informasi Layanan* (Scaling, Tambal, dll)\n' +
      '2️⃣ *Estimasi Harga Perawatan*\n' +
      '3️⃣ *Jadwal Dokter & Booking*\n' +
      '4️⃣ *Lokasi & Jam Operasional*\n\n' +
      '--- \n' +
      '_Ketik *menu* kapan saja untuk kembali ke pilihan utama._'
    );
  }

  if (m === '1') {
    return (
      '🦷 *Layanan Unggulan Kami:*\n\n' +
      '• *Scaling:* Pembersihan karang gigi secara menyeluruh.\n' +
      '• *Tambal Gigi:* Restorasi estetis untuk gigi berlubang.\n' +
      '• *Cabut Gigi:* Prosedur pencabutan minim rasa sakit.\n' +
      '• *Bleaching:* Pemutihan gigi profesional agar senyum lebih cerah.\n\n' +
      'Apakah ada layanan yang ingin Anda tanyakan lebih lanjut? Ketik *menu* untuk kembali.'
    );
  }

  if (m === '2') {
    return (
      '💰 *Daftar Estimasi Biaya Perawatan:*\n\n' +
      '• Scaling: Mulai dari Rp 150.000\n' +
      '• Tambal Gigi: Mulai dari Rp 200.000\n' +
      '• Cabut Gigi: Mulai dari Rp 300.000\n' +
      '• Bleaching: Mulai dari Rp 800.000\n\n' +
      '_*Catatan:* Harga bersifat estimasi, biaya akhir bergantung pada hasil pemeriksaan dokter di klinik._\n\n' +
      'Ketik *3* untuk langsung melihat jadwal & melakukan booking.'
    );
  }

  if (m === '3') {
    const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNamesId = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    
    let scheduleInfo = `📅 *JADWAL PRAKTEK DOKTER KAMI:*\n\n`;
    
    dayNamesId.forEach(day => {
      const slots = SCHEDULE[day];
      if (slots && slots.length > 0) {
        scheduleInfo += `📍 *${day.toUpperCase()}*\n`;
        slots.forEach(slot => {
          scheduleInfo += `• ${slot.jam}:\n   _${slot.dokter.join(', ')}_\n`;
          if (slot.keterangan) scheduleInfo += `   (${slot.keterangan})\n`;
        });
        scheduleInfo += `\n`;
      }
    });

    return (
      scheduleInfo +
      '📋 *PENDAFTARAN PASIEN*\n\n' +
      'Silakan salin dan lengkapi data berikut:\n\n' +
      '📑 *NIK (KTP/KK) :*\n' +
      '👤 *Nama Lengkap :*\n' +
      '🎂 *Umur :*\n' +
      '📍 *Tempat, Tanggal Lahir :*\n' +
      '🚶 *Jenis Kelamin :*\n' +
      '🏠 *Alamat Lengkap (Desa/Kec) :*\n' +
      '🏥 *Keluhan/Perawatan :*\n' +
      '🦷 *Pasien Lama/Baru :*\n' +
      '👨‍⚕️ *Pilihan Dokter :*\n' +
      '📅 *Hari/Tanggal :*\n' +
      '🕒 *Jam kunjungan :*\n' +
      '📞 *No Whatsapp :*\n\n' +
      '--- \n' +
      '_Admin akan memverifikasi jadwal Anda segera setelah data dikirim._'
    );
  }

  if (m === '4') {
    return (
      '📍 *Lokasi & Kontak Kami:*\n\n' +
      '🏠 *Alamat:* Jl. Contoh No.10, Bandung\n' +
      '🕒 *Jam Operasional:* Senin - Sabtu (08.00 - 17.00 WIB)\n' +
      '📞 *Telepon:* (022) 1234567\n' +
      '🗺️ *Google Maps:* https://maps.app.goo.gl/example\n\n' +
      'Kami tunggu kunjungan Anda!'
    );
  }

  return (
    'Maaf, saya belum memahami pesan Anda. 🙏\n\n' +
    'Silakan ketik *menu* untuk melihat pilihan layanan kami.'
  );
}

// ─────────────────────────────────────────
// Socket.io Events
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('status', botStatus);
  
  socket.on('control', async (action) => {
    if (action === 'start') {
      initializeBot();
    } else if (action === 'stop' && client) {
      updateStatus('Mematikan...');
      await client.destroy();
      client = null;
      updateStatus('Terputus');
    }
  });

  socket.on('get-reservations', () => {
    try {
      const data = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
      socket.emit('reservations', data);
    } catch (e) {}
  });
});

// ─────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────
app.post('/update-status', (req, res) => {
  const { id, status } = req.body;
  try {
    let reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const index = reservations.findIndex(r => r.id === id);
    if (index !== -1) {
      reservations[index].status = status;
      fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2));
      io.emit('reservations', reservations);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error('❌ Update Error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Dashboard aktif di http://localhost:${PORT}`);
});
