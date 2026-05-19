import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(resolve(here, '../src/client/public/sw.js'), 'utf8');
const discoverSource = readFileSync(resolve(here, '../src/client/pages/Discover.tsx'), 'utf8');
const passagesSource = readFileSync(resolve(here, '../src/server/routes/passages.ts'), 'utf8');

const required = [
  [swSource, 'e.notification?.data?.passageId', 'service worker reads notification passageId'],
  [swSource, '/discover?passageId=', 'service worker opens discover with passageId'],
  [swSource, 'source=push', 'service worker marks push source'],
  [discoverSource, "searchParams.get('passageId')", 'Discover reads passageId from URL'],
  [discoverSource, 'fetchPassageById', 'Discover loads exact clicked passage'],
  [discoverSource, 'apiFetch(`/passages/${encodeURIComponent(passageId)}${query}`)', 'authenticated exact-passage fetch uses API token'],
  [passagesSource, "passagesRouter.get('/passages/:id'", 'server exposes exact passage route'],
  [passagesSource, 'markPushHistoryRead', 'server marks matching push history read'],
  [passagesSource, "recordInteraction(prisma, userId, passage.id, 'view', 'push_inbox')", 'server records push-inbox view event'],
];

for (const [source, token, label] of required) {
  if (!source.includes(token)) {
    throw new Error(`Push click attribution policy missing: ${label} (${token})`);
  }
}

console.log('push click attribution policy check passed: notification clicks preserve passageId and authenticated reads feed personalization');
