const { setToken, clearToken } = require('./api-client');
const { fetchPatients } = require('./patient-fetcher');
const { generateDoc } = require('./doc-generator');
const { getDocsForInstalasi } = require('./doc-config');
const {
  setRangeSuffix,
  loadDoneKeys,
  logSuccess,
  logSkipped,
  logFailed,
  resetFailedLog,
} = require('./logger');
const { generateSummary } = require('./reporter');
const jobStore = require('./job-store');

/* ─── Serial Queue ─────────────────────────────────────────── */

let running = false;
const queue = [];

function enqueue(jobId) {
  if (!queue.includes(jobId)) queue.push(jobId);
  if (!running) processQueue();
}

function queueSize() {
  return queue.length + (running ? 1 : 0);
}

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const jobId = queue.shift();
    try {
      await runJob(jobId);
    } catch (err) {
      console.error(`[job-worker] Job ${jobId} fatal:`, err);
      jobStore.updateJob(jobId, {
        status: 'failed',
        error_message: err.message || String(err),
        finished_at: Date.now(),
      });
    }
  }
  running = false;
}

/* ─── Chunk util ───────────────────────────────────────────── */

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ─── Build tasks (diport dari index.js) ───────────────────── */

function buildTasks(patients, doneKeys, params) {
  const tasks = [];
  let skippedHandledByFe = 0;
  let skippedDone = 0;

  for (const p of patients) {
    const docs = getDocsForInstalasi(p.kd_instalasi);
    for (const doc of docs) {
      if (params.skipHandledByFe !== false && doc.handledByFe) {
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

  return { tasks, skippedDone, skippedHandledByFe };
}

/* ─── Main run ─────────────────────────────────────────────── */

async function runJob(jobId) {
  // Ambil job + user_token (via getJobForWorker, bukan getJob biasa)
  const job = jobStore.getJobForWorker(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (!job.user_token) {
    throw new Error(
      `Job ${jobId} tidak punya user_token. ` +
      `createJob() harus dipanggil dengan { userId, userToken }.`
    );
  }

  const params = job.params;
  console.log(
    `[job ${jobId}] Start. user_id=${job.user_id} params=`,
    params
  );

  // 1. Set token user untuk SEMUA request berikutnya.
  //    Tidak ada login() backend-to-backend lagi.
  setToken(job.user_token);

  // 2. Per-job output suffix — file terpisah per job
  const suffix = jobId.replace(/^bf_/, '');
  setRangeSuffix(suffix);

  try {
    // 3. Resume keys
    const doneKeys = loadDoneKeys({ retrySkipped: !!params.retrySkipped });
    console.log(`[job ${jobId}] Resume keys: ${doneKeys.size}`);

    jobStore.updateJob(jobId, {
      status: 'running',
      started_at: Date.now(),
      error_message: null,
    });

    // 4. Fetch patients
    const patients = await fetchPatients({
      instalasi: params.instalasi || '32',
      tanggalAwal: params.tanggalAwal,
      tanggalAkhir: params.tanggalAkhir,
      caraBayar: params.caraBayar || 'bpjs',
      statusCaseMix: params.statusCaseMix || 'final',
      limit: params.limitPasien || 6000,
      gabungTindakan: !!params.gabungTindakan,
    });
    console.log(`[job ${jobId}] Patients: ${patients.length}`);

    // 5. Build tasks
    const { tasks, skippedDone, skippedHandledByFe } = buildTasks(
      patients, doneKeys, params
    );
    const limitedTasks = params.limit ? tasks.slice(0, params.limit) : tasks;

    console.log(
      `[job ${jobId}] Tasks: ${limitedTasks.length} ` +
      `(done: ${skippedDone}, fe-handled: ${skippedHandledByFe})`
    );

    jobStore.updateJob(jobId, {
      total_patients: patients.length,
      total_tasks: limitedTasks.length,
    });

    if (limitedTasks.length === 0) {
      const summary = generateSummary({ elapsedMs: 0 });
      jobStore.updateJob(jobId, {
        status: 'completed',
        finished_at: Date.now(),
        summary: JSON.stringify(summary),
      });
      console.log(`[job ${jobId}] Nothing to do — completed.`);
      return;
    }

    // 6. Process
    resetFailedLog();
    const concurrency = params.concurrency || 3;
    const retries = params.retries || 3;

    const startTime = Date.now();
    let counter = 0;
    const batches = chunkArray(limitedTasks, concurrency);

    for (const batch of batches) {
      if (jobStore.isCancelled(jobId)) {
        console.log(`[job ${jobId}] Cancel requested — stop.`);
        break;
      }

      await Promise.all(
        batch.map(async (task) => {
          const result = await generateDoc(task.doc_type, task.params, {
            retries,
            isOptional: task.isOptional,
          });

          counter++;

          if (result.status === 'success') {
            logSuccess({
              no_registrasi: task.no_registrasi,
              doc_type: task.doc_type,
              name: task.name,
            });
            jobStore.incrementJob(jobId, { count_success: 1, done_tasks: 1 });
          } else if (result.status === 'skipped') {
            logSkipped({
              no_registrasi: task.no_registrasi,
              doc_type: task.doc_type,
              name: task.name,
              reason: result.reason,
              error: result.error,
            });
            jobStore.incrementJob(jobId, { count_skipped: 1, done_tasks: 1 });
          } else {
            logFailed({
              no_registrasi: task.no_registrasi,
              doc_type: task.doc_type,
              name: task.name,
              error: result.error,
            });
            jobStore.incrementJob(jobId, { count_failed: 1, done_tasks: 1 });
          }

          jobStore.updateJob(jobId, {
            current_patient: task.no_registrasi,
            current_doc: task.doc_type,
          });
        })
      );
    }

    // 7. Summary
    const elapsedMs = Date.now() - startTime;
    const summary = generateSummary({ elapsedMs });
    const finalStatus = jobStore.isCancelled(jobId) ? 'cancelled' : 'completed';

    jobStore.updateJob(jobId, {
      status: finalStatus,
      finished_at: Date.now(),
      summary: JSON.stringify(summary),
    });

    console.log(
      `[job ${jobId}] ${finalStatus} in ${Math.round(elapsedMs / 1000)}s ` +
      `(s=${summary.total_success}, f=${summary.total_failed}, k=${summary.total_skipped})`
    );
  } finally {
    // Cleanup token — job berikutnya akan setToken sendiri.
    clearToken();
  }
}

module.exports = { enqueue, queueSize };