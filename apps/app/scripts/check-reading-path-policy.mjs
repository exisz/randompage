import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const passagesRoute = readFileSync(resolve(here, '../src/server/routes/passages.ts'), 'utf8');
const discoverPage = readFileSync(resolve(here, '../src/client/pages/Discover.tsx'), 'utf8');
const blueprint = readFileSync(resolve(here, '../../../BLUEPRINT.md'), 'utf8');

const routeTokens = [
  "passagesRouter.get('/reading-path'",
  "passagesRouter.post('/reading-path/start'",
  'CREATE TABLE IF NOT EXISTS reading_paths',
  'READING_PATH_DAYS = 30',
  'filterReadablePassages(allPassages)',
  'scoreReadingPathCandidate',
  "recordInteraction(prisma, userId, current.passage.id, 'view', 'discover')",
];

for (const token of routeTokens) {
  if (!passagesRoute.includes(token)) {
    throw new Error(`reading path API missing token: ${token}`);
  }
}

const uiTokens = [
  '30-day passage path',
  "apiFetch('/reading-path')",
  "apiFetch('/reading-path/start'",
  'Day {readingPath.current.day}/{readingPath.totalDays}',
  'no summaries, no courses',
  'readingPath.upcoming.slice(0, 6)',
];

for (const token of uiTokens) {
  if (!discoverPage.includes(token)) {
    throw new Error(`reading path UI missing token: ${token}`);
  }
}

const blueprintTokens = [
  '/api/reading-path',
  'reading_paths',
  '30-day adaptive existing-passage path',
];

for (const token of blueprintTokens) {
  if (!blueprint.includes(token)) {
    throw new Error(`BLUEPRINT missing reading path token: ${token}`);
  }
}

console.log('reading path policy check passed: API, Discover UI, and blueprint are wired');
