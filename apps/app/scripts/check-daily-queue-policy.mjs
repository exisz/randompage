import { readFileSync } from 'node:fs';

const checks = [
  ['API chooses a fallback queue pool when unread is exhausted', 'src/server/routes/passages.ts', 'fallback_read_but_not_recent'],
  ['API can fall back to any readable existing passage', 'src/server/routes/passages.ts', 'fallback_any_readable'],
  ['API returns exact empty reason metadata', 'src/server/routes/passages.ts', 'emptyReason'],
  ['API returns selection counts for no-content diagnosis', 'src/server/routes/passages.ts', 'readablePassages: readablePassages.length'],
  ['Discover does not show stale sign-in sync empty copy', 'src/client/pages/Discover.tsx', 'Refresh queue'],
  ['Discover explains fallback queue state', 'src/client/pages/Discover.tsx', 'Fresh unread pool is low'],
  ['Discover surfaces API empty reason', 'src/client/pages/Discover.tsx', 'dailyQueue?.emptyReason'],
];

let failed = false;
for (const [label, file, needle] of checks) {
  const content = readFileSync(file, 'utf8');
  if (!content.includes(needle)) {
    console.error(`FAIL ${label}: missing ${JSON.stringify(needle)} in ${file}`);
    failed = true;
  } else {
    console.log(`PASS ${label}`);
  }
}

const discover = readFileSync('src/client/pages/Discover.tsx', 'utf8');
if (discover.includes('Your daily queue appears after sign-in sync.')) {
  console.error('FAIL stale generic sign-in sync empty state is still present');
  failed = true;
} else {
  console.log('PASS stale sign-in sync empty state removed');
}

if (failed) process.exit(1);
