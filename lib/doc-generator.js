const { client } = require('./api-client');

const SAVE_TO_RM = process.env.SAVE_TO_RM !== 'false';

/* ══════════════════════════════════════════════════════════════════════
   NO-DATA HINT PATTERNS
   Error yang match pattern ini dianggap "no data" (expected, bukan bug).
   ══════════════════════════════════════════════════════════════════════ */
const NO_DATA_HINT_PATTERNS = [
  /no data/i,
  /not found/i,
  /tidak ada data/i,
  /data kosong/i,
  /empty/i,
  /request error/i,
  /document generation failed/i,
];

function isNoDataHint(errorMsg) {
  if (!errorMsg) return false;
  const msg = String(errorMsg).toLowerCase();
  return NO_DATA_HINT_PATTERNS.some((re) => re.test(msg));
}

/**
 * Extract error message from axios error.
 * Return: { message, httpStatus }
 */
function extractErrorMessage(err) {
  if (!err.response) {
    return { message: err.message || 'Network error', httpStatus: 0 };
  }

  const { status, data } = err.response;
  let text = '';

  if (Buffer.isBuffer(data)) {
    text = data.toString('utf8');
  } else if (typeof data === 'string') {
    text = data;
  } else if (data && typeof data === 'object') {
    text = data.error || data.message || data.details || JSON.stringify(data);
    return { message: `HTTP ${status}: ${text}`, httpStatus: status };
  }

  if (text) {
    try {
      const parsed = JSON.parse(text);
      const msg = parsed.error || parsed.message || parsed.details || text;
      return { message: `HTTP ${status}: ${msg}`, httpStatus: status };
    } catch (_) {
      return {
        message: `HTTP ${status}: ${text.slice(0, 300)}`,
        httpStatus: status,
      };
    }
  }

  return { message: `HTTP ${status}`, httpStatus: status };
}

/**
 * Hit backend `doc/generate` untuk generate + simpan dokumen.
 *
 * Return:
 *   { status: 'success', size }
 *   { status: 'skipped', error, reason: 'optional_no_data' | 'no_data_hint' }
 *   { status: 'failed', error, httpStatus }
 *
 * @param {string} docType
 * @param {object} params
 * @param {object} opts
 * @param {number} opts.retries
 * @param {boolean} opts.isOptional - kalau true, semua error → skipped
 */
async function generateDoc(docType, params, { retries = 3, isOptional = false } = {}) {
  let lastError = null;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await client.post(
        'doc/generate',
        {
          doc_type: docType,
          params,
          format: 'pdf',
          save_to_rm: SAVE_TO_RM,
          options: { },
        },
        {
          responseType: 'arraybuffer',
          timeout: parseInt(process.env.REQUEST_TIMEOUT || '120000'),
        }
      );

      return { status: 'success', size: res.data?.byteLength || 0 };
    } catch (err) {
      const { message, httpStatus } = extractErrorMessage(err);
      lastError = message;
      lastStatus = httpStatus;

      // 5xx retry, 4xx jangan (kecuali 408/429/network error)
      const isClientError = httpStatus >= 400 && httpStatus < 500;
      const isRetryable =
        httpStatus === 408 || httpStatus === 429 || httpStatus === 0;

      if (isClientError && !isRetryable) break;

      if (attempt < retries) {
        const delay = 1000 * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ── Klasifikasi error ──
  if (isOptional) {
    // Dokumen optional — semua error = "skipped" (bukan gagal)
    return {
      status: 'skipped',
      error: lastError,
      reason: 'optional_no_data',
    };
  }

  if (isNoDataHint(lastError)) {
    // Dokumen required — tapi error-nya jelas "no data" → tetap skip
    return {
      status: 'skipped',
      error: lastError,
      reason: 'no_data_hint',
    };
  }

  return { status: 'failed', error: lastError, httpStatus: lastStatus };
}

module.exports = { generateDoc, isNoDataHint };