#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = {
  sw: 'src/client/public/sw.js',
  offline: 'src/client/lib/offline.ts',
  bookmarks: 'src/client/pages/Bookmarks.tsx',
  history: 'src/client/pages/History.tsx',
  discover: 'src/client/pages/Discover.tsx',
  listen: 'src/client/components/ListenControl.tsx',
};

const content = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]));

const checks = [
  ['service worker handles navigation fetches', content.sw.includes("request.mode === 'navigate'") && content.sw.includes("cache.match('/')")],
  ['service worker caches static assets', content.sw.includes('STATIC_CACHE_PREFIXES') && content.sw.includes("'/assets/'")],
  ['bookmarks writes and reads offline cache', content.bookmarks.includes('saveBookmarksOfflineCache') && content.bookmarks.includes('readBookmarksOfflineCache')],
  ['history writes and reads offline cache', content.history.includes('saveHistoryOfflineCache') && content.history.includes('readHistoryOfflineCache')],
  ['daily queue writes and reads offline cache', content.offline.includes('saveDailyQueueOfflineCache') && content.offline.includes('readDailyQueueOfflineCache') && content.discover.includes('saveDailyQueueOfflineCache') && content.discover.includes('readDailyQueueOfflineCache')],
  ['offline banner is visible on saved/push views', content.bookmarks.includes('Offline library mode') && content.history.includes('Offline inbox mode')],
  ['bookmarks offline banner documents cached listening', content.bookmarks.includes('Cached saved and queued passages can still be listened to with your browser voice')],
  ['history offline banner documents cached listening', content.history.includes('Cached history and push-inbox cards can still be listened to with your browser voice')],
  ['discover gives graceful offline network-only message', content.discover.includes('Fresh Discover recommendations need the network') && content.discover.includes('cached Bookmarks/History')],
  ['discover shows cached daily queue while offline', content.discover.includes('Today’s cached pages') && content.discover.includes('offline_cache') && content.discover.includes('Refreshing recommendations needs network')],
  ['discover cached daily listening avoids API calls', content.discover.includes('Offline listening uses your browser voice and does not call the API') && content.discover.includes('Listening from today’s cached offline queue')],
  ['discover points offline users to cached listening surfaces', content.discover.includes('read or listened to from cached Bookmarks/History') && content.discover.includes('read and listen to cached push-inbox cards')],
  ['listen control documents offline browser-speech behavior', content.listen.includes('navigator.onLine === false') && content.listen.includes('Offline cached listening uses your browser') && content.listen.includes('no audio file is downloaded')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
