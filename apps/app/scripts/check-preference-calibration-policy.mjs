import fs from 'node:fs';

const checks = [
  {
    file: 'src/server/routes/preferences.ts',
    must: [
      "preferencesRouter.post('/preferences/calibration'",
      'CALIBRATION_WANT_PREFIX',
      'CALIBRATION_AVOID_TEXT_PREFIX',
      'parseCalibrationTags',
      'fetchTagUniverse',
      'avoidPreferenceTag(tag)',
      'splitPreferenceControls(prefs)',
    ],
  },
  {
    file: 'src/client/pages/Settings.tsx',
    must: [
      'Preference note',
      'Save preference note',
      'Clear note',
      "apiFetch('/preferences/calibration'",
      'preferenceCalibration.reason',
      'local and deterministic',
    ],
  },
  {
    file: 'src/server/lib/preferenceControls.ts',
    must: [
      "export const CONTROL_TAG_PREFIX = 'control:'",
      'splitPreferenceControls',
      'preferenceMapWithoutAvoids',
    ],
  },
];

const missing = [];
for (const check of checks) {
  const text = fs.readFileSync(new URL(`../${check.file}`, import.meta.url), 'utf8');
  for (const needle of check.must) {
    if (!text.includes(needle)) missing.push(`${check.file}: missing ${needle}`);
  }
}

if (missing.length) {
  console.error('Preference calibration policy check failed:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('Preference calibration policy check passed');
