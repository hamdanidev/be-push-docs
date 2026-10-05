process.argv = [
  'node', 'index.js',
  '--range=16-23',
  '--from=16-06-2026',
  '--to=23-06-2026',
  '--concurrency=5',
  '--gabung-tindakan',
];
require('./index.js');