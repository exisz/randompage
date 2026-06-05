import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const routePath = resolve(here, '../src/server/routes/push.ts');
const source = readFileSync(routePath, 'utf8');
const handlerStart = source.indexOf('async function dailyPushHandler');
const postRouteStart = source.indexOf("pushRouter.post('/cron/daily-push'");
const getRouteStart = source.indexOf("pushRouter.get('/cron/daily-push'");
if (handlerStart === -1 || postRouteStart === -1 || getRouteStart === -1) {
  throw new Error('Missing GET/POST /api/cron/daily-push route');
}
const handlerEnd = source.indexOf('\n}\n\npushRouter.get', handlerStart);
const cronBlock = source.slice(handlerStart, handlerEnd === -1 ? source.length : handlerEnd);

const requiredInCron = [
  'sendPersonalizedPushes(prisma, subscriptions, passages',
  'personalized',
  'getAllPushSubscriptions(prisma)',
];
for (const token of requiredInCron) {
  if (!cronBlock.includes(token)) {
    throw new Error(`/api/cron/daily-push is missing shared personalized policy token: ${token}`);
  }
}

const requiredGlobally = [
  'normalizePushSubscriptionCreatedAt(prisma)',
  'unixepoch(created_at)',
  'findPushSubscriptionByUserEndpoint',
  'createPushSubscriptionRaw',
];
for (const token of requiredGlobally) {
  if (!source.includes(token)) {
    throw new Error(`push routes are missing subscription timestamp safety token: ${token}`);
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

console.log('push selection policy check passed: cron reuses shared personalized selection and exposes GET/POST');
