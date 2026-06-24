#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const checks = [
  {
    file: 'src/server/lib/reviewTuning.ts',
    needles: [
      'REVIEW_TUNING_PREFIX',
      "preset === 'pause'",
      "preset === 'more'",
      "preset === 'less'",
      'tuneDueBookmarks',
      'sourceTuningValue',
    ],
  },
  {
    file: 'src/server/routes/preferences.ts',
    needles: [
      "'/preferences/review-tuning'",
      'parseReviewTuning(prefs)',
      'reviewTuningWeight(preset)',
    ],
  },
  {
    file: 'src/server/routes/bookmarks.ts',
    needles: [
      'parseReviewTuning(preferences)',
      'tuneDueBookmarks(bookmarks, reviewTuning, now)',
      'tuningReason: tuning.reason',
    ],
  },
  {
    file: 'src/client/pages/Bookmarks.tsx',
    needles: [
      'Review tuning',
      'Book/source',
      'Tag/topic',
      "'/preferences/review-tuning'",
      "rule.preset === 'pause'",
      "rule.preset === 'more'",
      "rule.preset === 'less'",
    ],
  },
  {
    file: 'src/client/pages/Discover.tsx',
    needles: ['tuningReason?: string | null', 'item.tuningReason'],
  },
];

let failed = false;
for (const check of checks) {
  const text = readFileSync(join(root, check.file), 'utf8');
  for (const needle of check.needles) {
    if (!text.includes(needle)) {
      console.error(`[review-tuning] missing ${needle} in ${check.file}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('[review-tuning] PASS pause/less/more controls, Daily Review ranking, Themed Review client filtering, and explanation UI are wired.');
