const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');

// ─────────────────────────────────────────
// Memori Mute (Matikan bot per user)
// ─────────────────────────────────────────
const mutedUsers = new Map(); // Nomor -> Timestamp expired

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrImage = require('qr-image');
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
      // Simpan status pendaftaran (Baru/Lama)
      status: data.status || '-'
    });
    fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2));
    io.emit('reservations', reservations);
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

function isSlotTaken(tanggal, jam, dokter) {
  try {
    if (!fs.existsSync(RESERVATIONS_FILE)) return false;
    const reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const newMinutes = parseTimeToMinutes(jam);
    const newDoc = (dokter || '').toLowerCase().trim();

    console.log(`\n🔍 CEK ANTRIAN: ${tanggal} | ${jam} | ${newDoc}`);

    if (newMinutes === null) {
      return reservations.some(r =>
        r.tanggal.trim().toLowerCase() === tanggal.trim().toLowerCase() &&
        r.jam.trim().toLowerCase() === jam.trim().toLowerCase() &&
        (r.dokter || '').toLowerCase().trim() === newDoc
      );
    }

    return reservations.some(r => {
      // Cek tanggal harus sama (Gunakan normalize untuk hindari beda spasi/titik)
      const rDate = (r.tanggal || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const nDate = (tanggal || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (rDate !== nDate) return false;

      // Cek apakah dokter sama (kita izinkan jam sama kalau dokter beda)
      const existingDoc = (r.dokter || '').toLowerCase().trim();

      // Fuzzy matching: Jika nama dokter di database tidak mengandung unsur nama dokter baru, anggap dokter beda
      // dan izinkan (return false untuk bentrok)
      if (existingDoc && newDoc) {
        const cleanNew = newDoc.replace(/drg\.|dr\.|drg|dr/g, '').trim();
        const cleanExist = existingDoc.replace(/drg\.|dr\.|drg|dr/g, '').trim();

        const parts = cleanNew.split(' ').filter(p => p.length >= 2);
        const isSameDoc = parts.length > 0 && parts.some(p => cleanExist.includes(p));

        if (!isSameDoc) {
          console.log(`   ✅ Lolos (Beda Dokter): ${existingDoc} vs ${newDoc}`);
          return false;
        }
      }

      const existingMinutes = parseTimeToMinutes(r.jam);
      if (existingMinutes === null) return false;

      const minutesDiff = Math.abs(newMinutes - existingMinutes);
      const isTaken = minutesDiff < 30;

      if (isTaken) {
        console.log(`   ❌ BENTROK: ${r.nama} (${r.jam}) | Selisih: ${minutesDiff} menit`);
      }
      return isTaken;
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
// Fungsi Auto-Cleanup (Hapus Jadwal Lampau)
// ─────────────────────────────────────────
function cleanExpiredReservations() {
  try {
    if (!fs.existsSync(RESERVATIONS_FILE)) return;
    const reservations = JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8') || '[]');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthMap = {
      "januari": 0, "februari": 1, "maret": 2, "april": 3, "mei": 4, "juni": 5,
      "juli": 6, "agustus": 7, "september": 8, "oktober": 9, "november": 10, "desember": 11
    };

    const activeReservations = reservations.filter(r => {
      try {
        if (!r.tanggal) return false;
        // Format: "Senin, 30 Maret 2026"
        const cleanDate = r.tanggal.toLowerCase().split(',')[1]?.trim() || r.tanggal.toLowerCase();
        const parts = cleanDate.split(' '); // [30, "maret", 2026]

        if (parts.length === 3) {
          const day = parseInt(parts[0]);
          const month = monthMap[parts[1]];
          const year = parseInt(parts[2]);

          if (!isNaN(day) && month !== undefined && !isNaN(year)) {
            const resDate = new Date(year, month, day);
            return resDate >= today; // Pertahankan jika hari ini atau akan datang
          }
        }
        return true; // Jika gagal parse, pertahankan dulu agar aman
      } catch (e) { return true; }
    });

    if (activeReservations.length !== reservations.length) {
      console.log(`🧹 Antrean Lama Dihapus: ${reservations.length - activeReservations.length} data.`);
      fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(activeReservations, null, 2));
      io.emit('reservations', activeReservations);
    }
  } catch (err) {
    console.error('❌ Gagal Auto-Cleanup:', err);
  }
}

// ─────────────────────────────────────────
// Helper Utama: Waktu & Menit
// ─────────────────────────────────────────
function parseToMinutes(timeStr) {
  const match = (timeStr || '').match(/(\d{1,2})[:.](\d{2})/);
  if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
  return null;
}

// ─────────────────────────────────────────
// Konfigurasi Jadwal Resmi (Detik & Menit)
// ─────────────────────────────────────────
const CLINIC_SCHEDULE = {
  "senin": [
    { start: 600, end: 780, drs: ["Andhika", "Adillah"], text: "10.00-13.00" },
    { start: 960, end: 1080, drs: ["Tiara"], text: "16.00-18.00" },
    { start: 1170, end: 1260, drs: ["Andhika"], text: "19.30-21.00" }
  ],
  "selasa": [
    { start: 600, end: 780, drs: ["Adillah", "Andhika"], text: "10.00-13.00" },
    { start: 840, end: 960, drs: ["Habilludin", "Willy"], text: "14.00-16.00" },
    { start: 960, end: 1080, drs: ["Riski"], text: "16.00-18.00" },
    { start: 1170, end: 1260, drs: ["Adillah", "Andhika"], text: "19.30-21.00" }
  ],
  "rabu": [
    { start: 600, end: 780, drs: ["Habilludin"], text: "10.00-13.00" },
    { start: 960, end: 1080, drs: ["Riski", "Habilludin"], text: "16.00-18.00" },
    { start: 1170, end: 1260, drs: ["Andhika", "Habilludin"], text: "19.30-21.00" }
  ],
  "kamis": [
    { start: 600, end: 780, drs: ["Adillah", "Andhika"], text: "10.00-13.00" },
    { start: 840, end: 960, drs: ["Habilludin", "Willy"], text: "14.00-16.00" },
    { start: 960, end: 1080, drs: ["Riski"], text: "16.00-18.00" },
    { start: 1170, end: 1260, drs: ["Adillah", "Habilludin"], text: "19.30-21.00" }
  ],
  "jumat": [
    { start: 480, end: 660, drs: ["Habilludin"], text: "08.00-11.00" },
    { start: 840, end: 960, drs: ["Habilludin", "Willy"], text: "14.00-16.00" },
    { start: 960, end: 1080, drs: ["Tiara"], text: "16.00-18.00" },
    { start: 1170, end: 1260, drs: ["Andhika", "Habilludin"], text: "19.30-21.00" }
  ],
  "sabtu": [
    { start: 600, end: 840, drs: ["Adillah", "Andhika"], text: "10.00-14.00" },
    { start: 1170, end: 1260, drs: ["Andhika"], text: "19.30-21.00" }
  ],
  "minggu": [
    { start: 780, end: 1260, drs: ["Adillah", "Andhika"], text: "13.00-21.00" }
  ]
};

function isWithinSchedule(tanggal, jam, dokter) {
  const dayName = tanggal.split(',')[0].toLowerCase().trim();
  const targetMin = parseToMinutes(jam);
  const shifts = CLINIC_SCHEDULE[dayName];
  if (!shifts || targetMin === null) return { ok: false, msg: 'Hari atau format jam tidak dikenali.' };

  const cleanDr = (dokter || '').toLowerCase().replace(/drg\.|dr\.|drg|dr|sp\.bm/g, '').trim();

  // Cari shift yang menampung jam tsb DAN dokter tsb
  const matchingShift = shifts.find(s => {
    const timeMatch = targetMin >= s.start && targetMin <= s.end;
    const docMatch = s.drs.some(d => cleanDr.includes(d.toLowerCase()) || d.toLowerCase().includes(cleanDr));
    return timeMatch && docMatch;
  });

  if (matchingShift) return { ok: true };

  // Jika tidak ketemu, kasih saran jadwal dokter tsb di hari itu
  const dShifts = shifts.filter(s => s.drs.some(d => cleanDr.includes(d.toLowerCase()) || d.toLowerCase().includes(cleanDr)));
  if (dShifts.length > 0) {
    const times = dShifts.map(s => s.text).join(', ');
    return { ok: false, msg: `Maaf, ${dokter} bertugas di jam: ${times}.` };
  }

  return { ok: false, msg: `Maaf, ${dokter} tidak bertugas pada hari tersebut.` };
}
function getNearestDateOfDay(dayName) {
  const daysIndo = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const monthIndo = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const targetDay = daysIndo.indexOf(dayName.toLowerCase().trim());
  if (targetDay === -1) return dayName; // Bukan nama hari, kembalikan aslinya

  const today = new Date();
  const todayDay = today.getDay(); // 0(Min) - 6(Sab)

  let diff = targetDay - todayDay;
  if (diff < 0) diff += 7; // Jika sudah lewat, ambil minggu depan

  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + diff);

  const d = targetDate.getDate();
  const m = monthIndo[targetDate.getMonth()];
  const y = targetDate.getFullYear();
  const dayFixed = daysIndo[targetDate.getDay()].charAt(0).toUpperCase() + daysIndo[targetDate.getDay()].slice(1);

  return `${dayFixed}, ${d} ${m} ${y}`;
}

// ─────────────────────────────────────────
// Logika Inti Bot
// ─────────────────────────────────────────
function initializeBot() {
  if (client) {
    console.log('⚠️ Bot sudah berjalan atau sedang inisialisasi.');
    return;
  }

  // 🔓 Hapus SingletonLock agar tidak bentrok (Windows/Puppeteer Fix)
  const sessionDir = path.join(__dirname, '.wwebjs_auth', 'session-klinik-gigi-bot');
  const lockFile = path.join(sessionDir, 'SingletonLock');
  if (fs.existsSync(lockFile)) {
    try { fs.unlinkSync(lockFile); console.log('🔓 Lock File browser lama berhasil dibersihkan.'); } catch (e) { }
  }

  updateStatus('Menghubungkan...');
  console.log('🚀 Memulai inisialisasi WhatsApp Client...');
  console.log('⏳ Sedang meluncurkan browser (Puppeteer)... Mohon tunggu sebentar.');

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'klinik-gigi-bot',
      dataPath: './.wwebjs_auth'
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--disable-gpu',
        '--js-flags="--max-old-space-size=512"'
      ],
      timeout: 90000
    }
  });

  client.on('qr', (qr) => {
    const qrImage = require('qr-image'); // Pastikan package ini ada
    const qr_svg = qrImage.imageSync(qr, { type: 'svg' });
    const base64 = `data:image/svg+xml;base64,${Buffer.from(qr_svg).toString('base64')}`;
    io.emit('qr', base64);
    qrcodeTerminal.generate(qr, { small: true });
    updateStatus('Menunggu Scan QR');
  });

  client.on('ready', () => {
    console.log('✅ Bot LOGIN BERHASIL (Ready)!');
    updateStatus('Online');
  });

  client.on('authenticated', () => {
    console.log('🔐 WA TERAUTENTIKASI. Sedang memuat pesan...');
    updateStatus('Memuat Pesan...');
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
        const cleanLine = line.replace(/[*🪪👨👩👦⏳️📝📍🦷🗒🗓🕓📱]/g, '').trim();

        if (cleanLine.includes('NIK')) data.nik = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Nama Lengkap')) data.nama = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Tempat, Tanggal Lahir')) data.ttl = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Jenis Kelamin')) data.gender = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Alamat Lengkap')) data.alamat = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Keluhan/Perawatan')) data.keluhan = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Pasien Lama/Baru')) data.status = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Pilihan Dokter')) data.dokter = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Hari')) data.tanggal = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('Jam kunjungan')) data.jam = cleanLine.split(':')[1]?.trim() || '';
        if (cleanLine.includes('No Whatsapp')) data.wa = cleanLine.split(':')[1]?.trim() || '';
      });

      console.log('📩 Data pendaftaran terdeteksi:', data);

      if (data.nama && data.tanggal && data.jam) {
        // Validasi Kolom Wajib
        const required = ['nik', 'nama', 'tanggal', 'jam'];
        const missing = required.filter(key => !data[key]);

        if (missing.length > 0) {
          const labels = { nik: 'NIK', nama: 'Nama Lengkap', tanggal: 'Hari/Tanggal', jam: 'Jam Kunjungan' };
          const missingLabels = missing.map(m => labels[m]).join(', ');
          await message.reply(`⚠️ *DATA BELUM LENGKAP*\n\nMohon lengkapi kolom berikut: *${missingLabels}* agar pendaftaran dapat diproses. 🙏`);
          return;
        }

        // Auto-convert Hari -> Tanggal Lengkap
        data.tanggal = getNearestDateOfDay(data.tanggal);

        // 🟢 VALIDASI JAM VS JADWAL DOKTER
        const check = isWithinSchedule(data.tanggal, data.jam, data.dokter);
        if (!check.ok) {
          await message.reply(`❌ *JADWAL TIDAK SESUAI*\n\n${check.msg}\n\nMohon pilih jam yang sesuai atau cek jadwal di: http://localhost:3000/jadwal.html 🙏`);
          return;
        }

        // Cek Slot Bentrok (Sama-sama di satu jam yg persis sama)
        const isTaken = isSlotTaken(data.tanggal, data.jam, data.dokter);
        if (isTaken) {
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

    // Balasan Menu Biasa (Hanya jika ada balasan valid)
    const reply = getReply(body, message); // Kirim body dan message
    if (reply) {
      await message.reply(reply);
    }
  });

  console.log('🌐 Menunggu koneksi ke server WhatsApp Web...');
  client.initialize().then(() => {
    console.log('✅ Inisialisasi Selesai!');
  }).catch(err => {
    console.error('❌ Gagal saat mulai:', err);
    updateStatus('Error');
    client = null; // Reset agar bisa start ulang
  });
}

// ─────────────────────────────────────────
// Menu & Logika Percakapan (Hybrid)
// ─────────────────────────────────────────

function getReply(msg, message) {
  const from = message.from;
  const m = msg.toLowerCase().trim();

  // 1. Cek apakah user sedang di-Mute (Sedang bicara dengan Admin)
  if (mutedUsers.has(from)) {
    const expiredAt = mutedUsers.get(from);
    if (Date.now() < expiredAt) return null; // Diem saja, biarkan Admin chat manual
    mutedUsers.delete(from); // Sudah expired, bot bisa aktif lagi
  }

  // 2. Deteksi Menu Utama & Opsi 5 (Hanya jika belum dimute)
  const isGreeting = ['halo', 'menu', 'hi', 'start', 'hello', 'kak', 'pagi', 'siang', 'malam', 'p ', 'assalamu'].some(word => m.includes(word));
  if (isGreeting || ['p', 'tes'].includes(m)) {
    return (
      '✨ *Selamat Datang di Layanan Digital Klinik Gigi Tobi* ✨\n\n' +
      'Halo! Ada yang bisa kami bantu? 😁\n\n' +
      '📅 *Cek Jadwal Real-time:* \n' +
      '👉 http://localhost:3000/jadwal.html\n\n' +
      '📄 *Download Jadwal PDF:* \n' +
      '👉 http://localhost:3000/Jadwal.pdf\n\n' +
      'Ketik *angka* untuk layanan kami:\n' +
      '1️⃣ *Informasi Layanan*\n' +
      '2️⃣ *Estimasi Harga*\n' +
      '3️⃣ *Booking Jadwal (Isi Form)*\n' +
      '4️⃣ *Lokasi*\n' +
      '5️⃣ *Hubungi Admin (Chat Manual)*\n\n' +
      '--- \n' +
      '_Ketik *menu* untuk kembali._'
    );
  }

  if (m === '5') {
    // Aktifkan Mute selama 1 jam (3600000 ms)
    mutedUsers.set(from, Date.now() + 3600000);
    return '✅ *Pesan Anda telah diteruskan ke Admin.*\n\nMohon tunggu ya kak, Admin kami akan segera membalas chat Anda secara manual. Bot akan berhenti membalas nomor ini sementara waktu... 🙏';
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
    return (
      '📋 *PENDAFTARAN PASIEN*\n\n' +
      '🪪 *NIK (KTP/KK) Wajib Diisi :*\n' +
      '👨👩👦 *Nama Lengkap :*\n' +
      '⏳️ *Tempat, Tanggal Lahir :*\n' +
      '📝 *Jenis Kelamin :*\n' +
      '📍 *Alamat Lengkap :*\n' +
      '🦷 *Keluhan/Perawatan Gigi :*\n' +
      '🗒 *Pasien Lama/Baru :*\n' +
      '👨‍⚕️ *Pilihan Dokter :*\n' +
      '🗓 *Hari & Tanggal :* (Cth: Senin, 30 Maret)\n' +
      '🕓 *Jam kunjungan :*\n' +
      '📱 *No Whatsapp :*\n\n' +
      '_____\n' +
      'ℹ️ *INFORMASI :*\n' +
      '🗓 *Praktek Setiap Hari* (Senin - Minggu) 09.00 - 21.00\n' +
      '_*Jadwal dapat berubah sewaktu._\n\n' +
      '👨‍👩‍👧‍👦 *Kuota:* 15-20 Pasien/Hari.\n' +
      '🦷 *Dokter Gigi:* drg. Adillah, drg. Riski, drg. Tiara, drg. Andhika & drg. Habilludin\n' +
      '🦷 *Dokter Mitra Spesialis Bedah Mulut:* drg. Willy Bernadi Sp.BM\n\n' +
      '💸 *Biaya Admin:* 20.000\n\n' +
      '📌 Reservasi maksimal H-1 atau H-1 Minggu. Pasien yang belum reservasi dapat dilayani apabila jadwal kosong atau setelah antrian pasien reservasi selesai.\n\n' +
      '⏳ Dimohon datang tepat waktu pada saat jam estimasi kunjungan.\n' +
      '❌ Bila kunjungan dibatalkan, harap konfirmasi segera ya. Terima kasih! 🙏'
    );
  }

  if (m === '4') {
    return (
      '📍 *Lokasi Praktek Dokter Gigi Sumedang (Gigi Tobi)*\n\n' +
      '🦷 *Jl. Parigi Lama Karapyak (Depan SMPN 2 Sumedang).*\n\n' +
      '📌 *Google Maps:*\n' +
      'https://maps.app.goo.gl/SpCeVzgvznCGJUcG8\n\n' +
      '🚦 *Patokan:*\n' +
      '1. SMPN 2 Sumedang\n' +
      '2. Dinas Lingkungan Hidup\n' +
      '3. SAMSAT Sumedang\n' +
      '4. POLRES Sumedang\n' +
      '5. IPP Sumedang\n' +
      '6. Exit Toll Sumedang Kota\n\n' +
      '📞 *Kontak WhatsApp Praktek:*\n' +
      '📲 0813 9014 9191.\n\n' +
      'Ketik *menu* untuk kembali.'
    );
  }

  // 3. Kata Kunci Cerdas (Pintasan)
  if (['daftar', 'booking', 'registrasi'].some(word => m.includes(word))) {
    return getReply('3', message); // Lempar ke Opsi 3
  }

  if (['jadwal', 'hari', 'kapan', 'jam berapa'].some(word => m.includes(word))) {
    return (
      '📅 *CEK JADWAL DOKTER GIGI TOBI*\n\n' +
      'Untuk melihat jadwal tersedia secara real-time, silakan klik link di bawah ini:\n' +
      '👉 http://localhost:3000/jadwal.html\n\n' +
      'Anda bisa langsung memilih jam yang masih kosong di sana. 😊'
    );
  }

  // 4. SILENT FILTER: Jika tidak cocok dengan sapaan, angka menu, atau format form, DIAM.
  return null;
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
    } catch (e) { }
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
