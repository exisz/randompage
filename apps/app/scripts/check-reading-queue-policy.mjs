import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  helper: path.join(root, 'src/client/lib/readingQueue.ts'),
  discover: path.join(root, 'src/client/pages/Discover.tsx'),
  bookmarks: path.join(root, 'src/client/pages/Bookmarks.tsx'),
};

const checks = [
  [files.helper, 'randompage_my_reading_queue_v1', 'reading queue localStorage key'],
  [files.helper, 'addPassageToReadingQueue', 'queue add helper'],
  [files.helper, 'removePassageFromReadingQueue', 'queue remove helper'],
  [files.discover, 'Add to queue', 'Discover Add to queue action'],
  [files.discover, 'isPassageQueued', 'Discover duplicate queue guard'],
  [files.bookmarks, 'My Queue', 'Bookmarks My Queue surface'],
  [files.bookmarks, 'Remove from queue', 'queue item removal'],
  [files.bookmarks, 'Clear queue', 'queue clear control'],
  [files.bookmarks, 'Queued “', 'bookmark queue status feedback'],
  [files.bookmarks, 'ListenControl text={item.passage.text}', 'queued passage listening control'],
];

let failed = false;
for (const [file, needle, label] of checks) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!text.includes(needle)) {
    console.error(`✗ Missing ${label} (${needle}) in ${path.relative(root, file)}`);
    failed = true;
  } else {
    console.log(`✓ ${label}`);
  }
}

if (failed) process.exit(1);
console.log('Reading queue policy check passed.');
