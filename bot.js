const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Setup Adapter for Prisma 7
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PORT = process.env.PORT || 3000;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;

// ─────────────────────────────────────────
// API Endpoints
// ─────────────────────────────────────────

// GET Dynamic Schedule for all doctors
app.get('/api/schedule', async (req, res) => {
    try {
        const doctors = await prisma.doctor.findMany({
            include: { schedules: true }
        });
        
        // Transform to format expected by UI if needed, or send as is
        const formatted = {};
        doctors.forEach(dr => {
            dr.schedules.forEach(s => {
                if (!formatted[s.day]) formatted[s.day] = [];
                // Find or create block
                let block = formatted[s.day].find(b => b.start === s.startMinutes && b.end === s.endMinutes);
                if (!block) {
                    block = { start: s.startMinutes, end: s.endMinutes, drs: [] };
                    formatted[s.day].push(block);
                }
                block.drs.push(dr.nama);
            });
        });
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────
function parseToMinutes(timeStr) {
    const match = (timeStr || '').match(/(\d{1,2})[:.](\d{2})/);
    if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
    return null;
}

const isSlotTaken = async (tanggal, jam, doctorName) => {
    const reqMin = parseToMinutes(jam);
    if (reqMin === null) return false;

    // Ambil reservasi di tanggal dan jam tersebut untuk dokter tertentu
    const res = await prisma.reservation.findFirst({
        where: {
            tanggal: { contains: tanggal.substring(0, 10) },
            jam: jam,
            doctor: {
                nama: {
                    contains: doctorName,
                    mode: 'insensitive'
                }
            }
        }
    });

    return !!res;
};

const sendWHAMessage = async (to, text) => {
    try {
        const url = `https://graph.facebook.com/v17.0/${WA_PHONE_NUMBER_ID}/messages`;
        await axios.post(url, {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: { body: text }
        }, {
            headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` }
        });
        console.log(`✅ Message sent to ${to}`);
    } catch (err) {
        console.error(`❌ Error sending message:`, err.response?.data || err.message);
    }
};

// ─────────────────────────────────────────
// Webhook Handlers (Meta WA Cloud API)
// ─────────────────────────────────────────

// GET: Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === WA_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// POST: Message Incoming
app.post('/webhook', async (req, res) => {
    const data = req.body;
    if (data.object === 'whatsapp_business_account') {
        const entry = data.entry[0]?.changes[0]?.value;
        const msg = entry?.messages?.[0];

        if (msg && msg.type === 'text') {
            const from = msg.from;
            const text = msg.text.body;

            // Logika Registrasi Berdasarkan Format Lengkap
            if (text.toLowerCase().includes('nik') && text.toLowerCase().includes('nama')) {
                const lines = text.split('\n');
                const rawData = {};
                lines.forEach(l => {
                    const cleanValue = l.split(':')[1]?.trim() || '';
                    if (l.includes('NIK')) rawData.nik = cleanValue;
                    if (l.includes('Nama')) rawData.nama = cleanValue;
                    if (l.includes('Tempat, Tanggal Lahir')) rawData.ttl = cleanValue;
                    if (l.includes('Jenis Kelamin')) rawData.gender = cleanValue;
                    if (l.includes('Alamat')) rawData.alamat = cleanValue;
                    if (l.includes('Keluhan')) rawData.keluhan = cleanValue;
                    if (l.includes('Hari')) rawData.tanggal = cleanValue;
                    if (l.includes('Jam kunjungan')) rawData.jam = cleanValue;
                    if (l.includes('No Whatsapp')) rawData.wa = cleanValue;
                    if (l.includes('Dokter')) rawData.dokterName = cleanValue;
                });

                if (rawData.nik && rawData.nama && rawData.tanggal && rawData.jam) {
                    try {
                        // 1. Sinkronisasi Data Pasien (Cek NIK)
                        let patient = await prisma.patient.findUnique({
                            where: { nik: rawData.nik }
                        });

                        let statusFinal = "Baru";
                        if (!patient) {
                            patient = await prisma.patient.create({
                                data: {
                                    nik: rawData.nik,
                                    nama: rawData.nama,
                                    ttl: rawData.ttl,
                                    gender: rawData.gender,
                                    alamat: rawData.alamat,
                                    wa: rawData.wa,
                                    phone_number: from
                                }
                            });
                            statusFinal = "Baru";
                        } else {
                            statusFinal = "Lama";
                        }

                        // 2. Hubungkan Dokter
                        const doctor = await prisma.doctor.findFirst({
                            where: {
                                nama: {
                                    contains: rawData.dokterName || "Andhika",
                                    mode: 'insensitive'
                                }
                            }
                        });

                        if (!doctor) throw new Error("Dokter tidak ditemukan");

                        // 3. Cek Ketersediaan
                        const taken = await isSlotTaken(rawData.tanggal, rawData.jam, doctor.nama);
                        if (taken) {
                            await sendWHAMessage(from, "❌ *JADWAL PENUH*\n\nMaaf, jadwal tersebut sudah terisi. Silakan pilih jam lain di: http://localhost:3000/jadwal.html");
                        } else {
                            // 4. Buat Reservasi
                            await prisma.reservation.create({
                                data: {
                                    patientId: patient.id,
                                    doctorId: doctor.id,
                                    keluhan: rawData.keluhan,
                                    tanggal: rawData.tanggal,
                                    jam: rawData.jam,
                                    statusPasien: statusFinal
                                }
                            });
                            await sendWHAMessage(from, "✅ *RESERVASI BERHASIL*\n\nTerima kasih! Data pendaftaran Anda telah masuk ke sistem Klinik Gigi Tobi. Kami akan segera menghubungi Anda untuk konfirmasi.");
                        }
                    } catch (err) {
                        console.error("Error Registration:", err);
                        await sendWHAMessage(from, "❌ *SISTEM ERROR*\n\nMaaf, terjadi kesalahan saat memproses data Anda.");
                    }
                }
            } else if (text.toLowerCase() === 'info' || text.toLowerCase() === 'start' || text.toLowerCase() === 'halo') {
                const welcomeMsg = `👋 *Halo! Selamat datang di Klinik Gigi Tobi*\n\nSilakan isi format pendaftaran berikut untuk melakukan reservasi:\n\n🪪 NIK (KTP/KK) : \n👨‍👩‍👦 Nama Lengkap : \n⏳️ Tempat, Tanggal Lahir : \n📝 Jenis Kelamin : \n📍 Alamat Lengkap : \n🦷 Keluhan/Perawatan Gigi: \n🗒 Pasien Lama/Baru : \n🗓 Hari : \n🕓 Jam kunjungan : \n📱 No Whatsapp : \n\n_____\n*INFORMASI :*\n🗓 Praktek Setiap Hari (Senin - Minggu) 09.00 - 21.00\n💸 Biaya Admin 20.000\n\n📌 *Reservasi maksimal H-1.*\n\nCek Jadwal Dokter: http://localhost:3000/jadwal.html`;
                await sendWHAMessage(from, welcomeMsg);
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// ─────────────────────────────────────────
// Dashboard API Endpoints
// ─────────────────────────────────────────

// GET All Reservations
app.get('/api/reservations', async (req, res) => {
    try {
        const list = await prisma.reservation.findMany({
            include: {
                patient: true,
                doctor: true
            },
            orderBy: { timestamp: 'desc' }
        });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE Reservation Patient Status (Lama/Baru)
app.patch('/api/reservations/:id', async (req, res) => {
    const { id } = req.params;
    const { statusPasien } = req.body;
    try {
        const updated = await prisma.reservation.update({
            where: { id },
            data: { statusPasien }
        });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server Bot Klinik Gigi Tobi aktif di port ${PORT}`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📅 Jadwal Publik: http://localhost:${PORT}/jadwal.html`);
});
