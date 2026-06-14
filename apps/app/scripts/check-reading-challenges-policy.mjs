#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/routes/passages.ts', import.meta.url), 'utf8');
const discover = readFileSync(new URL('../src/client/pages/Discover.tsx', import.meta.url), 'utf8');

const checks = [
  {
    name: 'authenticated challenges API exists',
    ok: server.includes("passagesRouter.get('/reading/challenges'") && server.includes('verifyBearer(req.header'),
  },
  {
    name: 'progress is derived from existing truth tables',
    ok: ['browsingEvent.findMany', 'passageReview.count', 'pushHistory.count', 'FROM reading_paths', 'userPreference.findMany']
      .every((needle) => server.includes(needle)),
  },
  {
    name: 'fixed lightweight challenge set stays in RandomPage boundaries',
    ok: ['daily-3-pages', 'weekly-saved-review', 'path-progress', 'push-inbox-read', 'favorite-topic']
      .every((needle) => server.includes(needle)),
  },
  {
    name: 'Discover renders mobile-visible challenge panel',
    ok: discover.includes('Reading challenges')
      && discover.includes("apiFetch('/reading/challenges')")
      && discover.includes('progress progress-warning')
      && discover.includes('earned'),
  },
  {
    name: 'no new social/monetization/course mechanics introduced',
    ok: !/leaderboardId|leaderboardScore|subscriptionTier|pricingPlan|courseId|courseProgress|generatedSummary/i.test(server + discover),
  },
];

let failed = false;
for (const check of checks) {
  if (check.ok) {
    console.log(`PASS ${check.name}`);
  } else {
    failed = true;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed) process.exit(1);
console.log('PASS reading challenges policy');
