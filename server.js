require('dotenv').config();

const express = require('express');
const path = require('path');
const jobStore = require('./lib/job-store');
const { enqueue, queueSize } = require('./lib/job-worker');
const authMiddleware = require('./lib/auth-middleware');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'push-docs-api',
    version: '1.1.0',
    ts: new Date().toISOString(),
    endpoints: {
      health: '/v1.0/pushdocs/health',
      me:     '/v1.0/pushdocs/auth/me',
      jobs:   '/v1.0/pushdocs/jobs',
    },
  });
});

/* ─────────────────────────────────────────────────────────────
   AUTH MIDDLEWARE
   - Skip /pushdocs/health dan static (non-/pushdocs/)
   - Semua /pushdocs/* wajib Authorization header (raw token)
   ───────────────────────────────────────────────────────────── */
app.use(authMiddleware);


app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────────────────────────────────────────
   HEALTH (public)
   ───────────────────────────────────────────────────────────── */
app.get('/v1.0/pushdocs/health', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    queue_size: queueSize(),
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /pushdocs/auth/me — verifikasi token & lihat user
   ───────────────────────────────────────────────────────────── */
app.get('/v1.0/pushdocs/auth/me', (req, res) => {
  res.json({
    kd: req.user.kd,
    username: req.user.username,
    nama_lengkap: req.user.nama_lengkap,
    email: req.user.email,
    group: req.user.group?.nama || null,
  });
});

/* ─────────────────────────────────────────────────────────────
   Helper validasi tanggal DD-MM-YYYY
   ───────────────────────────────────────────────────────────── */
function isValidDateDMY(str) {
  return /^\d{2}-\d{2}-\d{4}$/.test(String(str || ''));
}

/* ─────────────────────────────────────────────────────────────
   POST /pushdocs/jobs — start job (return 202 + job_id)
   ───────────────────────────────────────────────────────────── */
app.post('/v1.0/pushdocs/jobs', (req, res) => {
  const b = req.body || {};

  const params = {
    instalasi: b.instalasi || process.env.KD_INSTALASI || '32',
    tanggalAwal: b.tanggalAwal || process.env.TANGGAL_AWAL,
    tanggalAkhir: b.tanggalAkhir || process.env.TANGGAL_AKHIR,
    caraBayar: b.caraBayar || 'bpjs',
    statusCaseMix: b.statusCaseMix || 'final',
    gabungTindakan: !!b.gabungTindakan,
    skipHandledByFe: b.skipHandledByFe !== false,
    retrySkipped: !!b.retrySkipped,
    limitPasien: b.limitPasien || parseInt(process.env.LIMIT_PASIEN || '6000'),
    limit: b.limit || null,
    concurrency: b.concurrency || parseInt(process.env.CONCURRENCY || '3'),
    retries: b.retries || parseInt(process.env.RETRY_COUNT || '3'),
  };

  if (!params.tanggalAwal || !params.tanggalAkhir) {
    return res.status(400).json({
      error: 'tanggalAwal & tanggalAkhir wajib diisi',
    });
  }

  if (!isValidDateDMY(params.tanggalAwal) || !isValidDateDMY(params.tanggalAkhir)) {
    return res.status(400).json({
      error: 'Format tanggal harus DD-MM-YYYY (contoh: 01-06-2026)',
    });
  }

  // Pass user context → worker akan pakai token ini
  const job = jobStore.createJob(params, {
    userId: req.user.kd,
    userToken: req.token,
  });

  enqueue(job.id);

  res.status(202).json({
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
    created_by: {
      kd: req.user.kd,
      username: req.user.username,
      nama: req.user.nama_lengkap,
    },
    poll_url: `/pushdocs/jobs/${job.id}`,
    result_url: `/pushdocs/jobs/${job.id}/result`,
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /pushdocs/jobs — list jobs
   Non-superadmin hanya lihat job miliknya sendiri.
   ───────────────────────────────────────────────────────────── */
app.get('/v1.0/pushdocs/jobs', (req, res) => {
  const isSuperadmin = req.user.group?.nama === 'superadmin';

  const jobs = jobStore.listJobs({
    status: req.query.status || undefined,
    userId: isSuperadmin ? undefined : req.user.kd,
    limit: parseInt(req.query.limit || '50'),
  });

  const out = jobs.map((j) => {
    const { summary, ...rest } = j;
    return { ...rest, has_result: !!summary };
  });

  res.json({
    jobs: out,
    queue_size: queueSize(),
    scope: isSuperadmin ? 'all' : 'own',
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /pushdocs/jobs/:id — polling status (ringan)
   ───────────────────────────────────────────────────────────── */
app.get('/v1.0/pushdocs/jobs/:id', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const isSuperadmin = req.user.group?.nama === 'superadmin';
  const isOwner = job.user_id === req.user.kd;
  if (!isSuperadmin && !isOwner) {
    return res.status(403).json({ error: 'Tidak berhak lihat job ini' });
  }

  const { summary, ...rest } = job;
  res.json({
    ...rest,
    has_result: !!summary,
    queue_size: queueSize(),
  });
});

/* ─────────────────────────────────────────────────────────────
   GET /pushdocs/jobs/:id/result — hasil final
   ───────────────────────────────────────────────────────────── */
app.get('/v1.0/pushdocs/jobs/:id/result', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const isSuperadmin = req.user.group?.nama === 'superadmin';
  const isOwner = job.user_id === req.user.kd;
  if (!isSuperadmin && !isOwner) {
    return res.status(403).json({ error: 'Tidak berhak lihat hasil job ini' });
  }

  if (!job.summary) {
    return res.status(409).json({
      error: 'Job belum selesai',
      status: job.status,
    });
  }

  res.json({
    job_id: job.id,
    status: job.status,
    started_at: job.started_at,
    finished_at: job.finished_at,
    counters: job.counters,
    summary: job.summary,
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /pushdocs/jobs/:id/cancel
   Hanya owner atau superadmin.
   ───────────────────────────────────────────────────────────── */
app.post('/v1.0/pushdocs/jobs/:id/cancel', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const isSuperadmin = req.user.group?.nama === 'superadmin';
  const isOwner = job.user_id === req.user.kd;
  if (!isSuperadmin && !isOwner) {
    return res.status(403).json({ error: 'Tidak berhak cancel job ini' });
  }

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return res.status(409).json({
      error: `Cannot cancel job with status ${job.status}`,
    });
  }

  jobStore.cancelJob(job.id);
  res.json({ job_id: job.id, status: 'cancelling' });
});

/* ─────────────────────────────────────────────────────────────
   GLOBAL ERROR HANDLER (JSON parse errors, dll)
   ───────────────────────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  res.status(500).json({ error: err.message || 'Internal error' });
});

/* ─────────────────────────────────────────────────────────────
   STARTUP RECOVERY
   Job 'running' saat startup = proses mati → requeue.
   Worker akan skip task yang sudah sukses via JSONL.
   ───────────────────────────────────────────────────────────── */
function recoverStalledJobs() {
  const stalled = jobStore.findStalledJobs();
  for (const j of stalled) {
    console.log(`[recovery] Requeue stalled job ${j.id}`);
    jobStore.updateJob(j.id, {
      status: 'queued',
      error_message: 'Requeued after server restart',
    });
  }

  const queued = jobStore.findQueuedJobs();
  for (const j of queued) {
    console.log(`[recovery] Enqueue queued job ${j.id}`);
    enqueue(j.id);
  }

  console.log(`[recovery] ${stalled.length} stalled, ${queued.length} queued`);
}

/* ─────────────────────────────────────────────────────────────
   LISTEN
   ───────────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT || '3001');
const server = app.listen(PORT, () => {
  console.log('═'.repeat(60));
  console.log(`Push Docs API listening on http://localhost:${PORT}`);
  console.log(`Health : http://localhost:${PORT}/v1.0/pushdocs/health`);
  console.log(`Me     : http://localhost:${PORT}/v1.0/pushdocs/auth/me`);
  console.log(`Jobs   : http://localhost:${PORT}/v1.0/pushdocs/jobs`);
  console.log(`UI     : http://localhost:${PORT}/`);
  console.log('═'.repeat(60));
  recoverStalledJobs();
});

/* Graceful shutdown */
function shutdown(signal) {
  console.log(`\n[server] ${signal} received — shutting down`);
  server.close(() => {
    console.log('[server] Closed. Bye.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));