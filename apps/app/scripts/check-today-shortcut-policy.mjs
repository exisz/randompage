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
const parseManifest = (file) => JSON.parse(read(file));
const requiredShortcuts = new Map([
  ['Today’s pages', '/today'],
  ['Review saved pages', '/bookmarks#daily-review-overview'],
  ['Saved library', '/bookmarks'],
  ['Push inbox', '/history?tab=push#push-inbox'],
]);
const hasShortcutSet = (manifest) => {
  if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length < requiredShortcuts.size) return false;
  return [...requiredShortcuts].every(([name, url]) => {
    const item = manifest.shortcuts.find((shortcut) => shortcut.name === name && shortcut.url === url);
    return item && item.short_name && item.description && Array.isArray(item.icons) && item.icons.some((icon) => icon.src && icon.sizes && icon.type);
  });
};
const manifest = parseManifest(files.manifest);
const webmanifest = parseManifest(files.webmanifest);
const checks = [
  ['client route /today is registered', read(files.main).includes('path="/today"') && read(files.main).includes('<Today />')],
  ['History route supports push inbox deep link', read(files.main).includes('path="/history"') && read(files.main).includes('<History />') && read(path.join(root, 'src/client/pages/History.tsx')).includes("searchParams.get('tab') === 'push")],
  ['Bookmarks route exposes Daily Review overview anchor', read(files.main).includes('path="/bookmarks"') && read(files.main).includes('<Bookmarks />') && read(path.join(root, 'src/client/pages/Bookmarks.tsx')).includes('id="daily-review-overview"')],
  ['Today page reads existing push history', read(files.today).includes("apiFetch('/push/history')")],
  ['Today page falls back to existing daily queue', read(files.today).includes("apiFetch('/passages/daily-queue?limit=3')")],
  ['Today page avoids false anonymous personalization', read(files.today).includes('Make Today personal') && read(files.today).includes("source: 'anonymous'")],
  ['Settings exposes Today shortcut instructions', read(files.settings).includes('Today shortcut') && read(files.settings).includes('Open Today page')],
  ['manifest declares RandomPage shortcut set', hasShortcutSet(manifest)],
  ['webmanifest declares RandomPage shortcut set', hasShortcutSet(webmanifest)],
  ['default PWA start path remains Discover', manifest.start_url === '/discover' && webmanifest.start_url === '/discover'],
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
