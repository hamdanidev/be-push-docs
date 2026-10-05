process.argv = [
  'node', 'index.js',
  '--range=24-30',
  '--from=24-06-2026',
  '--to=30-06-2026',
  '--concurrency=5',
  '--gabung-tindakan',
];
require('./index.js');