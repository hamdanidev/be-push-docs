process.argv = [
  'node', 'index.js',
  '--range=09-15',
  '--from=09-06-2026',
  '--to=15-06-2026',
  '--concurrency=5',
  '--gabung-tindakan',
];
require('./index.js');