#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const server = readFileSync(join(root, 'src/server/routes/passages.ts'), 'utf8');
const discover = readFileSync(join(root, 'src/client/pages/Discover.tsx'), 'utf8');
const history = readFileSync(join(root, 'src/client/pages/History.tsx'), 'utf8');
const dwell = readFileSync(join(root, 'src/client/lib/dwell.tsx'), 'utf8');

const checks = [
  ['server exposes dwell endpoint', server.includes("passagesRouter.post('/passages/:id/dwell'")],
  ['server stores dwell_ms on browsing_events', server.includes('ALTER TABLE browsing_events ADD COLUMN dwell_ms INTEGER') && server.includes('action IN (\'dwell\', \'engaged_read\')')],
  ['short bounces are bounded out', server.includes('MIN_DWELL_EVENT_MS') && server.includes('below_minimum_dwell')],
  ['sustained reads become engaged_read', server.includes('ENGAGED_READ_MS') && server.includes("? 'engaged_read' : 'dwell'")],
  ['Discover records active passage dwell', discover.includes('PassageDwellTracker')],
  ['History/push cards record visible dwell', history.includes('VisiblePassageDwellTracker')],
  ['client sends signed-in dwell through API', dwell.includes('/dwell') && dwell.includes('logtoClient.isAuthenticated')],
  ['reading stats expose minutes and 7d engaged count', discover.includes('todayReadingMinutes') && discover.includes('sevenDayEngagedCount')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Passage dwell policy check failed:');
  for (const [name] of failed) console.error(`- ${name}`);
  process.exit(1);
}
console.log('✅ passage dwell policy OK');
