require('dotenv').config();

const { login } = require('./lib/api-client');
const { fetchPatients } = require('./lib/patient-fetcher');
const { generateDoc } = require('./lib/doc-generator');
const { getDocsForInstalasi } = require('./lib/doc-config');
const {
  setRangeSuffix,
  loadDoneKeys,
  logSuccess,
  logSkipped,
  logFailed,
  resetFailedLog,
} = require('./lib/logger');
const { generateSummary } = require('./lib/reporter');

/* ══════════════════════════════════════════════════════════
   CLI ARGS PARSER
   ══════════════════════════════════════════════════════════ */
const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const DRY_RUN = args.includes('--dry-run');
const RETRY_SKIPPED = args.includes('--retry-skipped');
const GABUNG_TINDAKAN_FLAG = args.includes('--gabung-tindakan');

const RANGE = getArg('range', null);              // "01-08"
const FROM_DATE = getArg('from', null);           // "01-06-2026"
const TO_DATE = getArg('to', null);               // "08-06-2026"
const TASK_LIMIT = getArg('limit', null) ? parseInt(getArg('limit')) : null;

/* ══════════════════════════════════════════════════════════
   CONFIG
   ══════════════════════════════════════════════════════════ */
const CONFIG = {
  instalasi: getArg('instalasi', process.env.KD_INSTALASI || '32'),
  tanggalAwal: FROM_DATE || process.env.TANGGAL_AWAL,
  tanggalAkhir: TO_DATE || process.env.TANGGAL_AKHIR,
  caraBayar: getArg('bayar', process.env.CARA_BAYAR || 'bpjs'),
  statusCaseMix: getArg('status', process.env.STATUS_CASE_MIX || 'final'),
  limitPasien: parseInt(process.env.LIMIT_PASIEN || '6000'),
  gabungTindakan:
    GABUNG_TINDAKAN_FLAG ||
    process.env.GABUNG_TINDAKAN === 'true',
  concurrency: parseInt(getArg('concurrency', process.env.CONCURRENCY || '3')),
  retries: parseInt(process.env.RETRY_COUNT || '3'),
  skipHandledByFe: process.env.SKIP_HANDLED_BY_FE !== 'false',
  retrySkipped: RETRY_SKIPPED || process.env.RETRY_SKIPPED === 'true',
};

// Set range suffix ke logger
setRangeSuffix(RANGE);

/* ══════════════════════════════════════════════════════════
   UTILS
   ══════════════════════════════════════════════════════════ */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}j ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/* ══════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════ */
async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('═'.repeat(68));
  console.log('  🏥  BACKFILL CLAIM DOCS — SIMRS');
  console.log('═'.repeat(68));
  console.log(`  Base URL       : ${process.env.API_BASE_URL}`);
  console.log(`  Range Tag      : ${RANGE || '(none)'}`);
  console.log(`  Instalasi      : ${CONFIG.instalasi}${CONFIG.gabungTindakan ? ' (+ gabung tindakan)' : ''}`);
  console.log(`  Periode        : ${CONFIG.tanggalAwal} s/d ${CONFIG.tanggalAkhir}`);
  console.log(`  Cara Bayar     : ${CONFIG.caraBayar}`);
  console.log(`  Status Mix     : ${CONFIG.statusCaseMix}`);
  console.log(`  Concurrency    : ${CONFIG.concurrency}`);
  console.log(`  Retry          : ${CONFIG.retries}`);
  console.log(`  Save to RM     : ${process.env.SAVE_TO_RM !== 'false'}`);
  console.log(`  Retry Skipped  : ${CONFIG.retrySkipped}`);
  console.log(`  Dry-run        : ${DRY_RUN}`);
  console.log('═'.repeat(68));
  console.log('');

  // Validasi
  if (!CONFIG.tanggalAwal || !CONFIG.tanggalAkhir) {
    console.error('❌ TANGGAL_AWAL & TANGGAL_AKHIR wajib diisi (via .env atau --from/--to)');
    process.exit(1);
  }

  // ── 1. Login ──
  console.log('[1/4] 🔐 Login...');
  const user = await login();
  console.log(`      ✓ Login sebagai ${user.nama_lengkap} (${user.username})`);
  console.log('');

  // ── 2. Load done keys ──
  console.log('[2/4] 📖 Memuat daftar selesai sebelumnya...');
  const doneKeys = loadDoneKeys({ retrySkipped: CONFIG.retrySkipped });
  console.log(
    `      ✓ ${doneKeys.size} entri akan di-skip${
      CONFIG.retrySkipped ? ' (skipped akan di-retry)' : ''
    }`
  );
  console.log('');

  // ── 3. Fetch patients ──
  console.log('[3/4] 👥 Fetch daftar pasien...');
  const patients = await fetchPatients({
    instalasi: CONFIG.instalasi,
    tanggalAwal: CONFIG.tanggalAwal,
    tanggalAkhir: CONFIG.tanggalAkhir,
    caraBayar: CONFIG.caraBayar,
    statusCaseMix: CONFIG.statusCaseMix,
    limit: CONFIG.limitPasien,
    gabungTindakan: CONFIG.gabungTindakan,
  });
  console.log(`      ✓ Total pasien unik: ${patients.length}`);
  console.log('');

  if (patients.length === 0) {
    console.log('⚠  Tidak ada pasien yang cocok dengan filter. Berhenti.');
    return;
  }

  // ── 4. Build tasks ──
  console.log('[4/4] 📋 Membangun task list...');

  const tasks = [];
  let skippedDone = 0;
  let skippedHandledByFe = 0;

  for (const p of patients) {
    const docs = getDocsForInstalasi(p.kd_instalasi);

    for (const doc of docs) {
      if (CONFIG.skipHandledByFe && doc.handledByFe) {
        skippedHandledByFe++;
        continue;
      }
      if (!doc.docType || !doc.buildParams) continue;

      const key = `${p.no_registrasi}::${doc.docType}`;
      if (doneKeys.has(key)) {
        skippedDone++;
        continue;
      }

      tasks.push({
        no_registrasi: p.no_registrasi,
        nama_pasien: p.nama_pasien,
        kd_instalasi: p.kd_instalasi,
        doc_type: doc.docType,
        name: doc.name,
        params: doc.buildParams(p),
        isOptional: !!doc.optional,
      });
    }
  }

  console.log(`      ✓ Task baru           : ${tasks.length}`);
  console.log(`      ✓ Sudah selesai (skip) : ${skippedDone}`);
  console.log(`      ✓ FE-handled (skip)    : ${skippedHandledByFe}`);
  console.log('');

  if (tasks.length === 0) {
    console.log('🎉 Semua task sudah selesai sebelumnya. Tidak ada yang perlu diproses.');
    const summary = generateSummary({ elapsedMs: Date.now() - startTime });
    printSummary(summary);
    return;
  }

  const limitedTasks = TASK_LIMIT ? tasks.slice(0, TASK_LIMIT) : tasks;
  if (TASK_LIMIT && TASK_LIMIT < tasks.length) {
    console.log(`⚠  Task di-limit ke ${TASK_LIMIT} (dari ${tasks.length})`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log('🔍 DRY-RUN — tidak ada API call yang dilakukan.');
    console.log('');
    console.log('Contoh 5 task pertama:');
    limitedTasks.slice(0, 5).forEach((t, i) => {
      const tag = t.isOptional ? '[optional]' : '[required]';
      console.log(`  ${i + 1}. ${t.no_registrasi} · ${t.doc_type} ${tag}`);
      console.log(`     params: ${JSON.stringify(t.params)}`);
    });
    return;
  }

  resetFailedLog();

  // ── 5. Process ──
  console.log('🚀 Memproses... (Ctrl+C kapan saja untuk berhenti)');
  console.log('');

  let counter = 0;
  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  const batches = chunk(limitedTasks, CONFIG.concurrency);
  const totalTasks = limitedTasks.length;

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (task) => {
        const result = await generateDoc(task.doc_type, task.params, {
          retries: CONFIG.retries,
          isOptional: task.isOptional,
        });

        counter++;

        if (result.status === 'success') {
          successCount++;
          logSuccess({
            no_registrasi: task.no_registrasi,
            doc_type: task.doc_type,
            name: task.name,
          });
        } else if (result.status === 'skipped') {
          skippedCount++;
          logSkipped({
            no_registrasi: task.no_registrasi,
            doc_type: task.doc_type,
            name: task.name,
            reason: result.reason,
            error: result.error,
          });
        } else {
          failCount++;
          logFailed({
            no_registrasi: task.no_registrasi,
            doc_type: task.doc_type,
            name: task.name,
            error: result.error,
          });
        }

        const pct = ((counter / totalTasks) * 100).toFixed(1);
        const icon =
          result.status === 'success'
            ? '✓'
            : result.status === 'skipped'
              ? '⊘'
              : '✗';

        const suffix =
          result.status === 'success'
            ? ''
            : ` — ${String(result.error || '').slice(0, 60)}`;

        const rangeTag = RANGE ? `[${RANGE}] ` : '';

        process.stdout.write(
          `\r  ${rangeTag}[${counter}/${totalTasks}] (${pct}%) ${icon} ` +
            `${task.no_registrasi} · ${task.doc_type}${suffix}`.padEnd(150, ' ')
        );
      })
    );
  }

  console.log('');
  console.log('');

  // ── 6. Summary ──
  const elapsedMs = Date.now() - startTime;
  const summary = generateSummary({ elapsedMs });

  printSummary(summary);
  console.log(`  ⏱  Durasi: ${fmtDuration(elapsedMs)}`);
  console.log('═'.repeat(68));
  console.log('');

  console.log('📁 Output files:');
  const rangeSuffix = RANGE ? `-${RANGE}` : '';
  console.log(`   • output/success${rangeSuffix}.jsonl  — task sukses`);
  console.log(`   • output/skipped${rangeSuffix}.jsonl  — task skip (optional, no data)`);
  console.log(`   • output/failed${rangeSuffix}.jsonl   — task gagal riil`);
  console.log(`   • output/summary${rangeSuffix}.json   — ringkasan eksekusi`);
  console.log('');

  if (summary.total_failed > 0) {
    console.log('⚠  Ada task yang GAGAL riil. Cek file failed.');
    console.log('    Jalankan ulang script untuk retry (sukses & skipped di-skip).');
  } else {
    console.log('🎉 Semua task selesai tanpa error riil!');
  }
  console.log('');
}

function printSummary(summary) {
  console.log('═'.repeat(68));
  console.log('  📊  SUMMARY');
  console.log('═'.repeat(68));
  console.log(`  Total dicoba   : ${summary.total_attempted}`);
  console.log(`  ✓ Sukses       : ${summary.total_success}`);
  console.log(`  ⊘ Skip         : ${summary.total_skipped}   (optional, tidak ada data)`);
  console.log(`  ✗ Gagal        : ${summary.total_failed}   (butuh di-retry)`);
  console.log(`  🎯 Success Rate: ${summary.success_rate_pct}%   (sukses / (sukses+gagal))`);
  console.log('');

  if (Object.keys(summary.by_doc_type_success).length > 0) {
    console.log('  ✓ Sukses per dokumen:');
    Object.entries(summary.by_doc_type_success)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`      • ${k.padEnd(30)} ${v}`));
    console.log('');
  }

  if (Object.keys(summary.by_doc_type_skipped).length > 0) {
    console.log('  ⊘ Skip per dokumen:');
    Object.entries(summary.by_doc_type_skipped)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`      • ${k.padEnd(30)} ${v}`));
    console.log('');
  }

  if (Object.keys(summary.by_doc_type_failed).length > 0) {
    console.log('  ✗ Gagal per dokumen:');
    Object.entries(summary.by_doc_type_failed)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`      • ${k.padEnd(30)} ${v}`));
    console.log('');
  }
}

main().catch((err) => {
  console.error('');
  console.error('═'.repeat(68));
  console.error('  ❌  FATAL ERROR');
  console.error('═'.repeat(68));
  console.error(err);
  console.error('');
  process.exit(1);
});