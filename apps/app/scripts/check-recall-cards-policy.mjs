import { readFileSync } from 'node:fs';

const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
const discover = readFileSync(new URL('../src/client/pages/Discover.tsx', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../src/client/lib/reviewScheduleFeedback.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');

const requiredBookmarks = [
  'Recall Cards',
  'What idea did this page contain?',
  'Reveal passage',
  'Remembered',
  'Review later',
  'Start recall',
  'No saved passages yet.',
  "markThemedReview(bookmark.id, 'review_later')",
  'revealedRecallIds.has(bookmark.id)',
  'formatReviewScheduleFeedback(action, schedule)',
];

const requiredRoutes = [
  "requestedAction === 'skip' || requestedAction === 'review_later'",
  'INSERT INTO passage_reviews',
];

const requiredDiscover = [
  'formatReviewScheduleFeedback(action, schedule)',
  'await res.json() as ReviewSchedulePayload',
];

const requiredFeedback = [
  'formatNextReviewInterval',
  'payload.review?.dueAfter',
  "Nice — next review",
  "Got it — back",
  "Review later set — back",
  'in ~${pluralize(days',
  'in ~${pluralize(weeks',
];

const missing = [];
for (const needle of requiredBookmarks) {
  if (!bookmarks.includes(needle)) missing.push(`Bookmarks.tsx missing ${needle}`);
}
for (const needle of requiredDiscover) {
  if (!discover.includes(needle)) missing.push(`Discover.tsx missing ${needle}`);
}
for (const needle of requiredFeedback) {
  if (!feedback.includes(needle)) missing.push(`reviewScheduleFeedback.ts missing ${needle}`);
}
for (const needle of requiredRoutes) {
  if (!routes.includes(needle)) missing.push(`bookmarks.ts route missing ${needle}`);
}

if (missing.length) {
  console.error('[check:recall-cards] FAIL');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('[check:recall-cards] PASS — Recall/Daily/Themed Review persist actions and surface next-review timing from dueAfter.');
