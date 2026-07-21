#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/routes/passages.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/client/pages/Insights.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/client/pages/Settings.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/client/main.tsx', import.meta.url), 'utf8');

const checks = [
  {
    name: 'authenticated private insights API exists',
    ok: server.includes("passagesRouter.get('/reading/insights-wrapup'") && server.includes("verifyBearer(req.header('authorization'))"),
  },
  {
    name: 'wrap-up derives only from existing per-user RandomPage records',
    ok: ['browsingEvent.findMany', 'pushHistory.findMany', 'bookmark.findMany', 'passageReview.findMany', 'FROM reading_paths', 'userPreference.findMany']
      .every((needle) => server.includes(needle)),
  },
  {
    name: '7-day and 30-day windows are returned',
    ok: server.includes('buildInsightWindow(7') && server.includes('buildInsightWindow(30'),
  },
  {
    name: 'client route and settings entry exist',
    ok: main.includes('path="/insights"') && settings.includes('Insights / Wrap-up') && settings.includes('Open private wrap-up'),
  },
  {
    name: 'client renders required private wrap-up sections',
    ok: ['pages opened', 'Top books', 'Top authors', 'Top tags', 'Recently discovered sources', 'What to revisit next']
      .every((needle) => client.includes(needle)),
  },
  {
    name: 'empty state is honest and activity-building',
    ok: server.includes('Open, save, or review a few existing RandomPage book passages') && client.includes('Save or open pushed pages'),
  },
  {
    name: 'no external LLM/social/generated-summary/new-source mechanics introduced',
    ok: !/leaderboard|public profile|followers|goodreads|storygraph api|openai\.chat|createEmbedding|generatedSummary|summaryProvider|contentSourceAdapter|externalSource/i.test(server + client),
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
console.log('PASS insights wrap-up policy');
