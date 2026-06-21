// check:spaced-review (PLANET-3015)
//
// Guards the spaced-repetition increasing-interval scheduler for saved-passage review:
//   1. Consecutive 'reviewed' actions produce STRICTLY INCREASING dueAfter gaps, up to a hard cap.
//   2. A 'skip' shortens the next interval (item returns sooner than a reviewed one).
//   3. The interval is capped at a sane maximum and never grows unbounded.
//   4. The bookmarks route wires the helper (no flat addDays(now, 7) fixed schedule) and persists box.
//   5. Boundary stays on EXISTING saved passages: review_later returns tomorrow without ladder advance.
//
// The first part exercises the real helper math; the second part is a static guard on the route +
// recall-card UI so the schedule cannot silently regress to a fixed cadence.

import { readFileSync } from 'node:fs';
import {
  INTERVAL_LADDER_DAYS,
  MAX_BOX,
  computeReviewSchedule,
  deriveBoxFromHistory,
  nextBox,
} from '../src/server/lib/spacedReview.ts';

const failures = [];
const fail = (msg) => failures.push(msg);

const NOW = new Date('2026-06-21T06:00:00.000Z');
const gapDays = (schedule) => Math.round((schedule.dueAfter.getTime() - NOW.getTime()) / 86_400_000);

// --- 1. Consecutive reviewed actions => strictly increasing, capped intervals ---
{
  let box = null;
  const gaps = [];
  for (let i = 0; i < 8; i += 1) {
    const schedule = computeReviewSchedule(box, 'reviewed', NOW);
    gaps.push(gapDays(schedule));
    box = schedule.box;
  }
  // Each successful review must rest at least as long as the previous, and strictly longer until the cap.
  let sawStrictIncrease = false;
  for (let i = 1; i < gaps.length; i += 1) {
    if (gaps[i] < gaps[i - 1]) {
      fail(`reviewed gaps must never shrink: ${gaps.join(' -> ')}`);
      break;
    }
    if (gaps[i] > gaps[i - 1]) sawStrictIncrease = true;
  }
  if (!sawStrictIncrease) fail(`consecutive reviewed actions must strictly increase the interval somewhere: ${gaps.join(' -> ')}`);

  const maxGap = Math.max(...gaps);
  if (maxGap !== INTERVAL_LADDER_DAYS[MAX_BOX]) {
    fail(`max reviewed interval must equal the ladder cap (${INTERVAL_LADDER_DAYS[MAX_BOX]}), got ${maxGap}`);
  }
  // Cap must hold: pushing far beyond the ladder length must not exceed the cap.
  const capped = computeReviewSchedule(MAX_BOX + 99, 'reviewed', NOW);
  if (gapDays(capped) > INTERVAL_LADDER_DAYS[MAX_BOX]) {
    fail(`interval must be capped at ${INTERVAL_LADDER_DAYS[MAX_BOX]} days, got ${gapDays(capped)}`);
  }
}

// --- 2. Skip shortens the next interval vs a reviewed item at the same box ---
{
  const matureBox = MAX_BOX; // a well-retained item resting at the cap
  const reviewedAgain = computeReviewSchedule(matureBox, 'reviewed', NOW);
  const skipped = computeReviewSchedule(matureBox, 'skip', NOW);
  if (!(gapDays(skipped) < gapDays(reviewedAgain))) {
    fail(`skip must shorten the interval vs reviewed at box ${matureBox}: skip=${gapDays(skipped)} reviewed=${gapDays(reviewedAgain)}`);
  }
  // Repeated skips must keep returning soon and floor at the shortest interval.
  let box = MAX_BOX;
  for (let i = 0; i < 8; i += 1) {
    const schedule = computeReviewSchedule(box, 'skip', NOW);
    box = schedule.box;
  }
  const flooredSkip = computeReviewSchedule(box, 'skip', NOW);
  if (gapDays(flooredSkip) !== INTERVAL_LADDER_DAYS[0]) {
    fail(`repeated skips must floor at the shortest interval (${INTERVAL_LADDER_DAYS[0]}d), got ${gapDays(flooredSkip)}`);
  }
}

// --- 3. review_later is an explicit short reminder: tomorrow, no ladder advance ---
{
  const before = MAX_BOX;
  const later = computeReviewSchedule(before, 'review_later', NOW);
  if (gapDays(later) !== INTERVAL_LADDER_DAYS[0]) {
    fail(`review_later must schedule tomorrow (${INTERVAL_LADDER_DAYS[0]}d), got ${gapDays(later)}`);
  }
  if (later.box !== before) {
    fail(`review_later must not advance the box: before=${before} after=${later.box}`);
  }
}

// --- 4. Box derivation / first-review behavior ---
{
  if (deriveBoxFromHistory([]) !== null) fail('empty history must derive a null box');
  if (deriveBoxFromHistory([{ action: 'reviewed', box: 3 }]) !== 3) fail('persisted box must be honored');
  if (deriveBoxFromHistory([{ action: 'skip', box: null }]) !== 0) fail('a latest skip without box should derive box 0');
  // Legacy streak (no box column): three consecutive reviews approximate a higher box.
  const legacy = deriveBoxFromHistory([
    { action: 'reviewed', box: null },
    { action: 'reviewed', box: null },
    { action: 'reviewed', box: null },
  ]);
  if (legacy === null || legacy < 1) fail(`legacy reviewed streak must derive a positive box, got ${legacy}`);

  // First-ever review already rests longer than a fresh/forgotten item.
  const first = computeReviewSchedule(null, 'reviewed', NOW);
  if (gapDays(first) <= INTERVAL_LADDER_DAYS[0]) {
    fail(`first reviewed should rest longer than the shortest interval, got ${gapDays(first)}`);
  }
  // nextBox never escapes [0, MAX_BOX].
  for (const b of [-5, 0, 2, 99]) {
    for (const a of ['reviewed', 'skip', 'review_later']) {
      const nb = nextBox(b, a);
      if (nb < 0 || nb > MAX_BOX) fail(`nextBox(${b}, ${a}) out of range: ${nb}`);
    }
  }
}

// --- 5. Static route + UI guard: helper is wired, fixed schedule is gone, box is persisted ---
{
  const routes = readFileSync(new URL('../src/server/routes/bookmarks.ts', import.meta.url), 'utf8');
  const requiredRoute = [
    "from '../lib/spacedReview.js'",
    'computeReviewSchedule(',
    'deriveBoxFromHistory(',
    'INSERT INTO passage_reviews',
    'box',
    'ensurePassageReviewBoxColumn',
  ];
  for (const needle of requiredRoute) {
    if (!routes.includes(needle)) fail(`bookmarks.ts route missing ${needle}`);
  }
  if (/action === 'reviewed' \? addDays\(now, 7\)/.test(routes)) {
    fail('bookmarks.ts still uses the fixed addDays(now, 7) review schedule');
  }

  const bookmarksUi = readFileSync(new URL('../src/client/pages/Bookmarks.tsx', import.meta.url), 'utf8');
  for (const needle of ['Daily Review', 'Themed Review', "markThemedReview(bookmark.id, 'review_later')"]) {
    if (!bookmarksUi.includes(needle)) fail(`Bookmarks.tsx missing ${needle} (review surfaces must stay over saved passages)`);
  }
}

if (failures.length) {
  console.error('[check:spaced-review] FAIL');
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`[check:spaced-review] PASS — ladder ${INTERVAL_LADDER_DAYS.join('/')}d: consecutive reviews lengthen the interval (capped at ${INTERVAL_LADDER_DAYS[MAX_BOX]}d), skips shorten it, review_later returns tomorrow, and box is persisted on passage_reviews.`);
