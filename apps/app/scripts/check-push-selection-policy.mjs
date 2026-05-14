import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const routePath = resolve(here, '../src/server/routes/push.ts');
const source = readFileSync(routePath, 'utf8');
const cronStart = source.indexOf("pushRouter.post('/cron/daily-push'");
if (cronStart === -1) {
  throw new Error('Missing /api/cron/daily-push route');
}
const cronBlock = source.slice(cronStart, source.indexOf('\n});', cronStart) + 4);

const required = [
  'sendPersonalizedPushes(prisma, subscriptions, passages',
  'personalized',
];
for (const token of required) {
  if (!cronBlock.includes(token)) {
    throw new Error(`/api/cron/daily-push is missing shared personalized policy token: ${token}`);
  }
}

const banned = [
  'Math.floor(Math.random() * count)',
  'prisma.passage.count()',
  'findMany({ skip, take: 1 })',
];
for (const token of banned) {
  if (cronBlock.includes(token)) {
    throw new Error(`/api/cron/daily-push still contains pure-random selection: ${token}`);
  }
}

console.log('push selection policy check passed: cron reuses shared personalized selection');
