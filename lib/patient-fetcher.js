const { client } = require('./api-client');
const { INSTALASI_TINDAKAN_CODES } = require('./unitmap');

/**
 * Fetch daftar pasien dari `pasien-casemix/getlist`
 *
 * Support "gabungkan pasien tindakan" — kalau `gabungTindakan=true`,
 * fetch juga instalasi IGD (3), HD (32), Radioterapi (51),
 * Kemoterapi (57), Rehab (35).
 */
async function fetchPatients({
  instalasi,
  tanggalAwal,
  tanggalAkhir,
  caraBayar = 'bpjs',
  statusCaseMix = 'final',
  limit = 6000,
  gabungTindakan = false,
}) {
  const mainKd = parseInt(instalasi);
  const instalasiList = gabungTindakan
    ? Array.from(new Set([mainKd, ...INSTALASI_TINDAKAN_CODES]))
    : [mainKd];

  console.log(`  → Instalasi yang akan di-fetch: ${instalasiList.join(', ')}`);

  const all = [];

  for (const kd of instalasiList) {
    const params = {
      page: 1,
      limit,
      sort: 'id',
      order: 'asc',
      tanggal_awal: tanggalAwal,
      tanggal_akhir: tanggalAkhir,
      kd_instalasi: kd,
      cara_bayar: caraBayar,
      status_case_mix: statusCaseMix,
    };

    const res = await client.get('pasien-casemix/getlist', { params });
    const data = res.data?.data || [];
    const totalRow = res.data?.total_row || 0;

    console.log(`  → Instalasi ${kd}: ${data.length} pasien (total_row: ${totalRow})`);

    if (data.length >= limit) {
      console.warn(
        `  ⚠ Instalasi ${kd}: hasil mencapai LIMIT_PASIEN (${limit}). ` +
          `Mungkin masih ada data yang belum ter-fetch. Naikkan LIMIT_PASIEN di .env.`
      );
    }

    all.push(...data);
  }

  // Deduplicate by no_registrasi
  const map = new Map();
  for (const p of all) {
    if (p.no_registrasi && !map.has(p.no_registrasi)) {
      map.set(p.no_registrasi, p);
    }
  }

  return Array.from(map.values());
}

module.exports = { fetchPatients };