#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = {
  sw: 'src/client/public/sw.js',
  offline: 'src/client/lib/offline.ts',
  bookmarks: 'src/client/pages/Bookmarks.tsx',
  history: 'src/client/pages/History.tsx',
  discover: 'src/client/pages/Discover.tsx',
};

const content = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]));

const checks = [
  ['service worker handles navigation fetches', content.sw.includes("request.mode === 'navigate'") && content.sw.includes("cache.match('/')")],
  ['service worker caches static assets', content.sw.includes('STATIC_CACHE_PREFIXES') && content.sw.includes("'/assets/'")],
  ['bookmarks writes and reads offline cache', content.bookmarks.includes('saveBookmarksOfflineCache') && content.bookmarks.includes('readBookmarksOfflineCache')],
  ['history writes and reads offline cache', content.history.includes('saveHistoryOfflineCache') && content.history.includes('readHistoryOfflineCache')],
  ['offline banner is visible on saved/push views', content.bookmarks.includes('Offline library mode') && content.history.includes('Offline inbox mode')],
  ['discover gives graceful offline network-only message', content.discover.includes('Fresh Discover recommendations need the network') && content.discover.includes('Cached history')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
