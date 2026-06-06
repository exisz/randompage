import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
const bookmarks = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');

const checks = [
  ['bookmarks API exposes latest passage_reviews for due filtering', server.includes("passageReviews: { orderBy: { reviewedAt: 'desc' }, take: 1 }")],
  ['bookmarks API ensures passage_reviews exists before reads', server.includes('await ensurePassageReviewTable(prisma);')],
  ['Themed Review UI exists on Bookmarks', bookmarks.includes('Themed Review') && bookmarks.includes('Revisit a focused shelf')],
  ['theme selector offers tags and collections', bookmarks.includes('optgroup label="Tags"') && bookmarks.includes('optgroup label="Collections"')],
  ['queue limits focused review to 1–5 saved passages', bookmarks.includes('.slice(0, 5)')],
  ['review actions reuse existing daily-review endpoint', bookmarks.includes('apiFetch(`/daily-review/${bookmarkId}`')],
  ['empty theme state links back to Discover/Bookmarks', bookmarks.includes('No saved passages are due for this theme') && bookmarks.includes('to="/discover"')],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
