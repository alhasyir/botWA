import pkgClient from '@prisma/client';
const { PrismaClient } = pkgClient;
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import "dotenv/config";

// Setup Adapter for Prisma 7
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split('.').map(Number);
    return (h * 60) + (m || 0);
}

async function main() {
  console.log('🗑️ Membersihkan database...');
  await prisma.reservation.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.doctor.deleteMany();

  console.log('👨‍⚕️ Menanam data Doktor...');
  const drNames = [
    "drg. Andhika Surya", "drg. Adillah Faridh", "drg. Tiara Edyatami",
    "drg. Muhammad Habilludin", "drg. Willy Bernadi Sp.BM", "drg. Riski Yunika"
  ];
  const doctors = {};
  for (const name of drNames) {
    doctors[name] = await prisma.doctor.create({ data: { nama: name } });
  }

  const rawSchedule = {
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
      { "jam": "13.00 - 21.00", "dokter": ["drg. Adillah Faridh", "drg. Andhika Surya"] }
    ]
  };

  console.log('📅 Menanam data Jadwal Lengkap...');
  for (const [day, slots] of Object.entries(rawSchedule)) {
    for (const slot of slots) {
      const [startStr, endStr] = slot.jam.split(' - ').map(s => s.trim());
      const start = timeToMinutes(startStr);
      const end = timeToMinutes(endStr);
      
      for (const drName of slot.dokter) {
        if (doctors[drName]) {
          await prisma.schedule.create({
            data: {
              doctorId: doctors[drName].id,
              day: day,
              startMinutes: start,
              endMinutes: end
            }
          });
        }
      }
    }
  }

  console.log('👩‍👩‍👦 Menanam data Antrean Dummy (1 per Dokter)...');
  const dummyPatients = [
    { nik: "1001", nama: "Pasien Andhika", dr: "drg. Andhika Surya", tgl: "Senin, 30 Maret 2026", jam: "10.00", status: "Lama" },
    { nik: "1002", nama: "Pasien Adillah", dr: "drg. Adillah Faridh", tgl: "Senin, 30 Maret 2026", jam: "10.00", status: "Baru" },
    { nik: "1003", nama: "Pasien Tiara", dr: "drg. Tiara Edyatami", tgl: "Senin, 30 Maret 2026", jam: "16.00", status: "Lama" },
    { nik: "1004", nama: "Pasien Habilludin", dr: "drg. Muhammad Habilludin", tgl: "Rabu, 1 April 2026", jam: "10.00", status: "Baru" },
    { nik: "1005", nama: "Pasien Willy", dr: "drg. Willy Bernadi Sp.BM", tgl: "Selasa, 31 Maret 2026", jam: "14.00", status: "Lama" },
    { nik: "1006", nama: "Pasien Riski", dr: "drg. Riski Yunika", tgl: "Selasa, 31 Maret 2026", jam: "16.00", status: "Baru" }
  ];

  for (const p of dummyPatients) {
    const patient = await prisma.patient.create({
      data: { nik: p.nik, nama: p.nama, phone_number: "62899"+p.nik, alamat: "Klinik Tobi" }
    });

    await prisma.reservation.create({
      data: {
        patientId: patient.id,
        doctorId: doctors[p.dr].id,
        keluhan: "Pemeriksaan rutin Dokter " + p.dr,
        tanggal: p.tgl,
        jam: p.jam,
        statusPasien: p.status
      }
    });
  }

  console.log('✨ SELESAI! Jadwal dikembalikan ke default dan data dummy lengkap telah ditanam.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
