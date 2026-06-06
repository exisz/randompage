import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  main: path.join(root, 'src/client/main.tsx'),
  today: path.join(root, 'src/client/pages/Today.tsx'),
  settings: path.join(root, 'src/client/pages/Settings.tsx'),
  manifest: path.join(root, 'src/client/public/manifest.json'),
  webmanifest: path.join(root, 'src/client/public/manifest.webmanifest'),
};

const read = (file) => fs.readFileSync(file, 'utf8');
const checks = [
  ['client route /today is registered', read(files.main).includes('path="/today"') && read(files.main).includes('<Today />')],
  ['Today page reads existing push history', read(files.today).includes("apiFetch('/push/history')")],
  ['Today page falls back to existing daily queue', read(files.today).includes("apiFetch('/passages/daily-queue?limit=3')")],
  ['Today page avoids false anonymous personalization', read(files.today).includes('Make Today personal') && read(files.today).includes("source: 'anonymous'")],
  ['Settings exposes Today shortcut instructions', read(files.settings).includes('Today shortcut') && read(files.settings).includes('Open Today page')],
  ['manifest declares /today PWA shortcut', read(files.manifest).includes('"url": "/today"')],
  ['webmanifest declares /today PWA shortcut', read(files.webmanifest).includes('"url": "/today"')],
];

const failures = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
}

if (failures.length > 0) {
  console.error(`Today shortcut policy failed: ${failures.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

console.log('Today shortcut policy passed');
