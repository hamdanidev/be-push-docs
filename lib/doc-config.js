const {
  IGD,
  RAJAL,
  RANAP,
  RADIOTERAPI,
  HEMODIALISA,
  KEMOTERAPI,
  REHAB,
} = require('./unitmap');

/**
 * Port dari `src/pages/v2.0/eclaim-docs/constants.js`
 * DOC_CONFIG — daftar dokumen yang bisa di-generate backend.
 *
 * Flag `optional: true` → kalau backend return error (no data),
 * maka statusnya "skipped", bukan "failed".
 */
const ALL_INSTALASI = [
  RAJAL.kd_instalasi,
  RANAP.kd_instalasi,
  parseInt(IGD.kd_instalasi),
  REHAB.kd_instalasi,
  HEMODIALISA.kd_instalasi,
  RADIOTERAPI.kd_instalasi,
  KEMOTERAPI.kd_instalasi,
];

const DOC_CONFIG = [
  // ═══════════════════════════════════════════════════════════
  // REQUIRED (semua instalasi)
  // ═══════════════════════════════════════════════════════════
  {
    id: '11',
    name: 'Billing',
    tipe: 'billing',
    docType: 'billing',
    instalasi: ALL_INSTALASI,
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '1',
    name: 'LIP Pasien',
    tipe: 'lip',
    docType: null,
    handledByFe: true,
    instalasi: ALL_INSTALASI,
  },
  {
    id: '2',
    name: 'SEP',
    tipe: 'sep',
    docType: 'sep',
    instalasi: ALL_INSTALASI,
    buildParams: (p) => ({
      no_registrasi: p.no_registrasi,
      no_sep: p.no_sep,
    }),
  },
  {
    id: '9',
    name: 'S.O.A.P.I',
    tipe: 'soap',
    docType: 'soap',
    instalasi: [
      RAJAL.kd_instalasi,
      parseInt(IGD.kd_instalasi),
      REHAB.kd_instalasi,
      HEMODIALISA.kd_instalasi,
      RADIOTERAPI.kd_instalasi,
      KEMOTERAPI.kd_instalasi,
    ],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },

  // ═══════════════════════════════════════════════════════════
  // OPTIONAL (kondisional — tidak semua pasien punya)
  // ═══════════════════════════════════════════════════════════
  {
    id: '3',
    name: 'SPRI',
    tipe: 'spri',
    docType: 'spri',
    optional: true,
    instalasi: [RANAP.kd_instalasi],
    buildParams: (p) => ({
      no_registrasi: p.no_registrasi,
      no_referensi: p.no_referensi,
      is_bpjs: String(p.cara_bayar || '').toLowerCase() === 'bpjs',
    }),
  },
  {
    id: '4',
    name: 'Triase',
    tipe: 'triase',
    docType: 'triase',
    optional: true,
    instalasi: [parseInt(IGD.kd_instalasi), RANAP.kd_instalasi],
    buildParams: (p) => ({
      no_registrasi: p.no_registrasi,
      kd_instalasi: p.kd_instalasi,
      no_referensi: p.no_referensi,
    }),
  },
  {
    id: '5',
    name: 'Radiologi',
    tipe: 'rad',
    docType: 'rad',
    optional: true,
    instalasi: [
      RAJAL.kd_instalasi,
      RANAP.kd_instalasi,
      parseInt(IGD.kd_instalasi),
      REHAB.kd_instalasi,
    ],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '6',
    name: 'Lab',
    tipe: 'lab',
    docType: 'lab',
    optional: true,
    instalasi: [
      RAJAL.kd_instalasi,
      RANAP.kd_instalasi,
      parseInt(IGD.kd_instalasi),
    ],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '7',
    name: 'Operasi',
    tipe: 'operasi',
    docType: 'operasi',
    optional: true,
    instalasi: [
      RAJAL.kd_instalasi,
      RANAP.kd_instalasi,
      parseInt(IGD.kd_instalasi),
    ],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },

  // ═══════════════════════════════════════════════════════════
  // REQUIRED (per instalasi)
  // ═══════════════════════════════════════════════════════════
  {
    id: '8',
    name: 'Resume Medis',
    tipe: 'resume_medis',
    docType: 'resume_medis',
    instalasi: [
      RANAP.kd_instalasi,
      parseInt(IGD.kd_instalasi),
      HEMODIALISA.kd_instalasi,
      RADIOTERAPI.kd_instalasi,
      KEMOTERAPI.kd_instalasi,
    ],
    buildParams: (p) => ({
      no_registrasi: p.no_registrasi,
      version: 'verifikator',
    }),
  },
  {
    id: '18',
    name: 'Formulir Rawat Jalan',
    tipe: 'asesmen_rehab_outpatient',
    docType: 'asesmen_rehab_outpatient',
    instalasi: [REHAB.kd_instalasi],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '16',
    name: 'Prosedur KFR',
    tipe: 'prosedur_kfr',
    docType: 'prosedur_kfr',
    instalasi: [REHAB.kd_instalasi],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '17',
    name: 'Jadwal & Tindakan Terapi',
    tipe: 'jadwal_tindakan_terapi',
    docType: 'jadwal_tindakan_terapi',
    instalasi: [REHAB.kd_instalasi],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '14',
    name: 'Askep Hemodialisa',
    tipe: 'askep_hemodialisa',
    docType: 'askep_hemodialisa',
    instalasi: [HEMODIALISA.kd_instalasi],
    buildParams: (p) => ({ no_registrasi: p.no_registrasi }),
  },
  {
    id: '15',
    name: 'Berkas Digital',
    tipe: 'berkas_digital',
    docType: 'berkas_digital',
    handledByFe: true,
    instalasi: ALL_INSTALASI,
  },
];

/**
 * Cari dokumen yang relevan untuk instalasi tertentu.
 */
function getDocsForInstalasi(kdInstalasi) {
  const kd = parseInt(kdInstalasi);
  return DOC_CONFIG.filter((doc) => doc.instalasi.includes(kd));
}

module.exports = {
  ALL_INSTALASI,
  DOC_CONFIG,
  getDocsForInstalasi,
};