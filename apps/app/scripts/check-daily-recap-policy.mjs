#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/routes/passages.ts', import.meta.url), 'utf8');
const discover = readFileSync(new URL('../src/client/pages/Discover.tsx', import.meta.url), 'utf8');

const checks = [
  {
    name: 'authenticated daily recap API exists',
    ok: server.includes("passagesRouter.get('/reading/daily-recap'") && server.includes('verifyBearer(req.header'),
  },
  {
    name: 'recap derives from existing per-user RandomPage tables',
    ok: ['browsingEvent.findMany', 'pushHistory.count', 'bookmark.count', 'passageReview.count', 'FROM reading_paths', 'userPreference.findMany']
      .every((needle) => server.includes(needle)),
  },
  {
    name: 'client sends local day boundaries for honest daily scope',
    ok: discover.includes('function localDayRange')
      && discover.includes('/reading/daily-recap?')
      && discover.includes('start.setHours(0, 0, 0, 0)'),
  },
  {
    name: 'Discover renders daily recap metrics and next-step CTA',
    ok: discover.includes('Daily recap')
      && discover.includes('pages opened')
      && discover.includes('push reads')
      && discover.includes('saved today')
      && discover.includes('Next: {dailyRecap.nextStep.label}'),
  },
  {
    name: 'empty day is honest and points to fresh pages',
    ok: server.includes('No reading activity recorded for your local day yet')
      && server.includes('Start today’s fresh pages')
      && server.includes('No private recap metrics yet'),
  },
  {
    name: 'no Headway-copy or external content/LLM mechanics introduced',
    ok: !/leaderboard|paywall|subscriptionTier|courseId|podcast|videoSummary|openai|embedding|generatedSummary/i.test(server + discover),
  },
];

let failed = false;
for (const check of checks) {
  if (check.ok) console.log(`PASS ${check.name}`);
  else {
    failed = true;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed) process.exit(1);
console.log('PASS daily recap policy');
