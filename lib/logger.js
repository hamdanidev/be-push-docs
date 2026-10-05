const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// Suffix per proses (dari CLI --range=XXX)
// Default: kosong → file named: success.jsonl, skipped.jsonl, dst
// Kalau --range=01-08 → file: success-01-08.jsonl, dst
let RANGE_SUFFIX = '';

function setRangeSuffix(suffix) {
  RANGE_SUFFIX = suffix ? `-${suffix}` : '';
}

function getFileName(base) {
  // base: 'success' | 'skipped' | 'failed' | 'summary'
  const ext = base === 'summary' ? 'json' : 'jsonl';
  return `${base}${RANGE_SUFFIX}.${ext}`;
}

function ensureDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function appendJSONL(baseName, obj) {
  ensureDir();
  const fileName = getFileName(baseName);
  fs.appendFileSync(
    path.join(OUTPUT_DIR, fileName),
    JSON.stringify(obj) + '\n',
    'utf8'
  );
}

function readKeysFromJSONL(baseName) {
  ensureDir();
  const fileName = getFileName(baseName);
  const filePath = path.join(OUTPUT_DIR, fileName);
  if (!fs.existsSync(filePath)) return new Set();

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const keys = new Set();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      keys.add(`${obj.no_registrasi}::${obj.doc_type}`);
    } catch (_) {
      // ignore malformed line
    }
  }

  return keys;
}

/**
 * Load semua key yang sudah di-handle (sukses + skipped) untuk range ini.
 *
 * @param {object} opts
 * @param {boolean} opts.retrySkipped - kalau true, `skipped` TIDAK di-skip
 * @returns {Set<string>} set of `${no_registrasi}::${doc_type}`
 */
function loadDoneKeys({ retrySkipped = false } = {}) {
  const success = readKeysFromJSONL('success');
  const skipped = retrySkipped ? new Set() : readKeysFromJSONL('skipped');
  return new Set([...success, ...skipped]);
}

function logSuccess({ no_registrasi, doc_type, name }) {
  appendJSONL('success', {
    ts: new Date().toISOString(),
    no_registrasi,
    doc_type,
    name,
  });
}

function logSkipped({ no_registrasi, doc_type, name, reason, error }) {
  appendJSONL('skipped', {
    ts: new Date().toISOString(),
    no_registrasi,
    doc_type,
    name,
    reason,
    error: String(error || '').slice(0, 1000),
  });
}

function logFailed({ no_registrasi, doc_type, name, error }) {
  appendJSONL('failed', {
    ts: new Date().toISOString(),
    no_registrasi,
    doc_type,
    name,
    error: String(error || '').slice(0, 1000),
  });
}

function resetFailedLog() {
  ensureDir();
  const fileName = getFileName('failed');
  const filePath = path.join(OUTPUT_DIR, fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = {
  OUTPUT_DIR,
  setRangeSuffix,
  getFileName,
  appendJSONL,
  loadDoneKeys,
  logSuccess,
  logSkipped,
  logFailed,
  resetFailedLog,
};