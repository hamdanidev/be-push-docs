process.argv = [
  'node', 'index.js',
  '--range=01-08',
  '--from=01-06-2026',
  '--to=08-06-2026',
  '--concurrency=5',
  '--gabung-tindakan',
];
require('./index.js');