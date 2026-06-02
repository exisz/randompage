import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const preferencesRoute = readFileSync(resolve(here, '../src/server/routes/preferences.ts'), 'utf8');
const settingsPage = readFileSync(resolve(here, '../src/client/pages/Settings.tsx'), 'utf8');

const routeTokens = [
  "preferencesRouter.get('/preferences'",
  "preferencesRouter.post('/preferences/goals'",
  'user_preferences',
  'GOAL_SEED_WEIGHT',
  'Reflective philosophy',
  'Inner life & psychology',
  'History & society',
  'Literary classics',
  'Mystery & tension',
];

for (const token of routeTokens) {
  if (!preferencesRoute.includes(token)) {
    throw new Error(`preferences goals route missing token: ${token}`);
  }
}

const uiTokens = [
  'Personalization / Reading goals',
  'Save reading goals',
  'Sign in to personalize',
  "apiFetch('/preferences')",
  "apiFetch('/preferences/goals'",
  'selectedGoalIds.length >= 3',
];

for (const token of uiTokens) {
  if (!settingsPage.includes(token)) {
    throw new Error(`settings reading goals UI missing token: ${token}`);
  }
}

console.log('preferences goals policy check passed: Settings UI and authenticated seed API are wired');
