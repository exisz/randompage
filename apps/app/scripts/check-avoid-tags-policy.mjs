import { readFileSync } from 'node:fs';

const files = {
  preferences: 'src/server/routes/preferences.ts',
  passages: 'src/server/routes/passages.ts',
  push: 'src/server/routes/push.ts',
  settings: 'src/client/pages/Settings.tsx',
  controls: 'src/server/lib/preferenceControls.ts',
};

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const checks = [
  ['preferences exposes selected avoid tags', files.preferences, 'selectedAvoidTags'],
  ['preferences persists avoid tags in existing user_preferences rows', files.preferences, "POST /api/preferences/avoid-tags"],
  ['avoid prefs use namespaced tags', files.controls, "avoid:"],
  ['random Discover scoring applies avoidance', files.passages, 'scorePassageTagsWithAvoidance(p.tags, prefMap, avoidTags)'],
  ['daily queue scoring applies avoidance', files.passages, 'scoreDailyQueueCandidate(passage, prefMap, avoidTags, seed)'],
  ['push selection scoring applies avoidance', files.push, 'scorePassageTagsWithAvoidance(p.tags, prefMap, avoidTags)'],
  ['settings renders Avoid for now UI', files.settings, 'Avoid for now'],
  ['settings saves avoid tags endpoint', files.settings, "/preferences/avoid-tags"],
  ['UI copy avoids hard safety claims', files.settings, "not a hard safety filter"],
];

let failed = false;
for (const [label, path, needle] of checks) {
  const ok = read(path).includes(needle);
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('Avoid tag personalization policy check passed.');
