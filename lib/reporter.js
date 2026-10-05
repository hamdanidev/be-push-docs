const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, getFileName } = require('./logger');

function readJSONL(fileName) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function groupByDocType(items) {
  const map = {};
  for (const i of items) {
    map[i.doc_type] = (map[i.doc_type] || 0) + 1;
  }
  return map;
}

function generateSummary({ elapsedMs = 0 } = {}) {
  const successes = readJSONL(getFileName('success'));
  const skipped = readJSONL(getFileName('skipped'));
  const failures = readJSONL(getFileName('failed'));

  const totalAttempted = successes.length + skipped.length + failures.length;

  // Success rate = sukses / (sukses + gagal). Skipped tidak masuk denominator.
  const denom = successes.length + failures.length;
  const successRatePct =
    denom > 0 ? ((successes.length / denom) * 100).toFixed(2) : '0.00';

  const summary = {
    generated_at: new Date().toISOString(),
    elapsed_seconds: Math.round(elapsedMs / 1000),
    total_attempted: totalAttempted,
    total_success: successes.length,
    total_skipped: skipped.length,
    total_failed: failures.length,
    success_rate_pct: successRatePct,
    by_doc_type_success: groupByDocType(successes),
    by_doc_type_skipped: groupByDocType(skipped),
    by_doc_type_failed: groupByDocType(failures),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, getFileName('summary')),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  return summary;
}

module.exports = { generateSummary };