#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const checks = [];
function expect(file, needle, label) {
  const text = readFileSync(join(root, file), 'utf8');
  const ok = text.includes(needle);
  checks.push({ ok, label, file, needle });
}

expect('src/server/routes/bookmarks.ts', "bookmarksRouter.get('/daily-review/overview'", 'signed-in Daily Review overview endpoint exists');
expect('src/server/routes/bookmarks.ts', 'tuneDueBookmarks(bookmarks, reviewTuning, now)', 'overview reuses spaced-review due logic with review tuning');
expect('src/server/routes/bookmarks.ts', "return 'all_paused_by_tuning';", 'overview reports review-tuning empty state');
expect('src/server/routes/bookmarks.ts', 'annotationCount', 'overview exposes private note/line-thought indicators without summaries');
expect('src/client/pages/Bookmarks.tsx', 'Today’s saved-page review', 'Bookmarks exposes a visible all-due review entry');
expect('src/client/pages/Bookmarks.tsx', "apiFetch('/daily-review/overview')", 'client fetches the overview endpoint');
expect('src/client/pages/Bookmarks.tsx', 'All due saved pages', 'client labels full due queue, not one-card stepping');
expect('src/client/pages/Bookmarks.tsx', 'all_paused_by_tuning', 'client explains tuning-paused empty state');
expect('src/client/pages/Bookmarks.tsx', 'Reconnect to compute today’s fresh saved-page review queue', 'offline mode does not pretend to compute fresh due state');
expect('src/client/pages/Bookmarks.tsx', "markThemedReview(item.bookmarkId, 'review_later')", 'overview rows can review later using existing spaced-review action');
expect('src/client/pages/Bookmarks.tsx', 'Related saved pages', 'overview rows preserve related saved-pages branch');

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error('Daily Review overview policy check failed:');
  for (const check of failed) console.error(`- ${check.label} (${check.file}) missing: ${check.needle}`);
  process.exit(1);
}
console.log(`Daily Review overview policy check passed (${checks.length} checks).`);
