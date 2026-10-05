const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'output');
const DB_PATH = path.join(DB_DIR, 'jobs.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    params TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    updated_at INTEGER,
    finished_at INTEGER,
    total_patients INTEGER DEFAULT 0,
    done_patients INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 0,
    done_tasks INTEGER DEFAULT 0,
    count_success INTEGER DEFAULT 0,
    count_failed INTEGER DEFAULT 0,
    count_skipped INTEGER DEFAULT 0,
    current_patient TEXT,
    current_doc TEXT,
    error_message TEXT,
    summary TEXT,
    cancel_requested INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
`);

/* ────────────────────────────────────────────────────────────
   MIGRATION: tambah kolom user_id & user_token (idempotent)
   Dipanggil sekali saat module load. Kalau kolom sudah ada,
   tidak ada perubahan.
   ──────────────────────────────────────────────────────────── */
function ensureColumn(table, column, type) {
  const cols = db.pragma(`table_info(${table})`);
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[job-store] Migration: added column ${table}.${column}`);
  }
}

ensureColumn('jobs', 'user_id', 'INTEGER');
ensureColumn('jobs', 'user_token', 'TEXT');

/* ──────────────────────────────────────────────────────────── */

function generateJobId() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `bf_${ts}_${rand}`;
}

function safeParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

/**
 * Convert DB row → job object untuk RESPONSE HTTP.
 * CATATAN: user_token TIDAK dimasukkan (rahasia).
 */
function rowToJob(row) {
  return {
    id: row.id,
    status: row.status,
    params: safeParse(row.params),
    created_at: row.created_at,
    started_at: row.started_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
    user_id: row.user_id,
    progress: {
      total_patients: row.total_patients,
      done_patients: row.done_patients,
      total_tasks: row.total_tasks,
      done_tasks: row.done_tasks,
      percent:
        row.total_tasks > 0
          ? Math.round((row.done_tasks / row.total_tasks) * 10000) / 100
          : 0,
    },
    counters: {
      success: row.count_success,
      failed: row.count_failed,
      skipped: row.count_skipped,
    },
    current: {
      no_registrasi: row.current_patient,
      tipe_dokumen: row.current_doc,
    },
    cancel_requested: !!row.cancel_requested,
    error_message: row.error_message,
    summary: safeParse(row.summary),
  };
}

/**
 * Convert DB row → job object KHUSUS worker (dengan token).
 * JANGAN panggil dari route HTTP.
 */
function rowToJobInternal(row) {
  return {
    ...rowToJob(row),
    user_token: row.user_token,
  };
}

/* ──────────────────────────────────────────────────────────── */

/**
 * @param {object} params - filter backfill
 * @param {object} [user] - { userId, userToken } (dari middleware auth)
 */
function createJob(params, user = {}) {
  const id = generateJobId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO jobs (id, status, params, created_at, updated_at, user_id, user_token)
    VALUES (?, 'queued', ?, ?, ?, ?, ?)
  `).run(
    id,
    JSON.stringify(params),
    now,
    now,
    user.userId || null,
    user.userToken || null
  );
  return getJob(id);
}

/**
 * Ambil job untuk HTTP response (TANPA user_token).
 */
function getJob(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

/**
 * Ambil job untuk worker (DENGAN user_token).
 * Hanya dipakai internal dari job-worker.js.
 */
function getJobForWorker(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJobInternal(row) : null;
}

function updateJob(id, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const fields = keys.map((k) => `${k} = ?`);
  const values = keys.map((k) => patch[k]);
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function incrementJob(id, deltas) {
  const keys = Object.keys(deltas);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ${k} + ?`);
  const values = keys.map((k) => deltas[k]);
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function cancelJob(id) {
  db.prepare(
    'UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?'
  ).run(Date.now(), id);
}

function isCancelled(id) {
  const row = db.prepare('SELECT cancel_requested FROM jobs WHERE id = ?').get(id);
  return !!(row && row.cancel_requested);
}

function listJobs({ status, userId, limit = 50 } = {}) {
  let q = 'SELECT * FROM jobs';
  const conds = [];
  const params = [];

  if (status) { conds.push('status = ?'); params.push(status); }
  if (userId !== undefined && userId !== null) {
    conds.push('user_id = ?');
    params.push(userId);
  }

  if (conds.length) q += ' WHERE ' + conds.join(' AND ');
  q += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(q).all(...params).map(rowToJob);
}

/**
 * Saat server restart, job status 'running' = proses mati.
 * Requeue supaya resume (task sukses di-skip via JSONL).
 */
function findStalledJobs() {
  return db
    .prepare("SELECT * FROM jobs WHERE status = 'running'")
    .all()
    .map(rowToJob);
}

function findQueuedJobs() {
  return db
    .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC")
    .all()
    .map(rowToJob);
}

module.exports = {
  createJob,
  getJob,
  getJobForWorker,
  updateJob,
  incrementJob,
  cancelJob,
  isCancelled,
  listJobs,
  findStalledJobs,
  findQueuedJobs,
};