#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = {
  helper: 'src/server/lib/recommendationExplanation.ts',
  passages: 'src/server/routes/passages.ts',
  push: 'src/server/routes/push.ts',
  discover: 'src/client/pages/Discover.tsx',
  history: 'src/client/pages/History.tsx',
};

const contents = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]),
);

const checks = [
  ['helper computes matched tags from parsePassageTags', contents.helper.includes('parsePassageTags') && contents.helper.includes('matchedTags')],
  ['helper uses preference weights instead of hard-coded marketing copy', contents.helper.includes('prefMap') && contents.helper.includes('MIN_VISIBLE_WEIGHT')],
  ['Discover random passage API returns whyPersonalized', /passages\/random[\s\S]*whyPersonalized/.test(contents.passages)],
  ['Daily queue items return whyPersonalized', /daily-queue[\s\S]*whyPersonalized/.test(contents.passages)],
  ['Browsing history API returns whyPersonalized', /browsing\/history[\s\S]*whyPersonalized/.test(contents.passages)],
  ['Push inbox history API returns whyPersonalized', /push\/history[\s\S]*whyPersonalized/.test(contents.push)],
  ['Discover UI shows Why this page explanation', contents.discover.includes('Why this page?') && contents.discover.includes('whyPersonalized.reason')],
  ['History UI shows Why this page explanation', contents.history.includes('Why this page?') && contents.history.includes('whyPersonalized.reason')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
if (failed.length) process.exit(1);
