/**
 * Port dari `src/constants/static/unitmap.js`
 * Hanya field yang dibutuhkan untuk backfill script.
 */
module.exports = {
  IGD: { kd_instalasi: '3', nama_instalasi: 'IGD' },
  RAJAL: { kd_instalasi: 1, nama_instalasi: 'Rawat Jalan' },
  RANAP: { kd_instalasi: 2, nama_instalasi: 'Rawat Inap' },
  RADIOTERAPI: { kd_instalasi: 51, nama_instalasi: 'Radioterapi' },
  HEMODIALISA: { kd_instalasi: 32, nama_instalasi: 'Hemodialisa' },
  KEMOTERAPI: { kd_instalasi: 57, nama_instalasi: 'Kemoterapi' },
  REHAB: { kd_instalasi: 35, nama_instalasi: 'Rehab Medik' },
  MCU: { kd_instalasi: 70, nama_instalasi: 'MCU' },

  // Mapping instalasi kode untuk "gabungkan pasien tindakan"
  INSTALASI_TINDAKAN_CODES: [3, 32, 51, 57, 35],

  INSTALLATIONS: [
    { kd: 3, nama: 'IGD' },
    { kd: 1, nama: 'Rawat Jalan' },
    { kd: 2, nama: 'Rawat Inap' },
    { kd: 51, nama: 'Radioterapi' },
    { kd: 32, nama: 'Hemodialisa' },
    { kd: 57, nama: 'Kemoterapi' },
    { kd: 35, nama: 'Rehabilitasi Medik' },
  ],
};