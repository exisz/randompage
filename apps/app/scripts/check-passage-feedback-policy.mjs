#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = {
  routes: 'src/server/routes/passages.ts',
  discover: 'src/client/pages/Discover.tsx',
  history: 'src/client/pages/History.tsx',
  chips: 'src/client/components/PassageFeedbackChips.tsx',
};

const text = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]));

const checks = [
  ['server exposes authenticated feedback endpoint', text.routes.includes("post('/passages/:id/feedback'") && text.routes.includes('verifyBearer')],
  ['feedback actions are persisted as browsing events', ['more_like_this', 'less_like_this', 'too_dense', 'different_topic'].every((action) => text.routes.includes(action)) && text.routes.includes('browsingEvent.create')],
  ['tag preference weights are bounded', text.routes.includes('MAX_PREFERENCE_WEIGHT') && text.routes.includes('MIN_PREFERENCE_WEIGHT')],
  ['Discover renders feedback chips', text.discover.includes('PassageFeedbackChips') && text.discover.includes("source={pushSource === 'push'")],
  ['History / Push inbox renders feedback chips', text.history.includes('PassageFeedbackChips') && text.history.includes("source={h.kind === 'push'")],
  ['anonymous users get sign-in copy', text.chips.includes('Sign in to teach RandomPage') && text.chips.includes('/signin')],
  ['double-submit is guarded', text.chips.includes('if (pending || submitted || disabled) return') && text.chips.includes('disabled={disabled || Boolean(pending) || Boolean(submitted)}')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
}

if (failed.length > 0) {
  console.error(`\nPassage feedback policy failed: ${failed.map(([label]) => label).join('; ')}`);
  process.exit(1);
}

console.log('\nPassage feedback policy passed.');
