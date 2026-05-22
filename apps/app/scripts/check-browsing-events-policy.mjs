#!/usr/bin/env node
/**
 * Lightweight regression guard for RandomPage engagement telemetry.
 * It asserts the server keeps a browsing_events table, records discover views,
 * records push inbox reads with source=push_inbox, and does not swallow the
 * push-click recordInteraction path from /api/passages/:id.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const passagesSource = readFileSync(resolve(here, '../src/server/routes/passages.ts'), 'utf8');
const discoverSource = readFileSync(resolve(here, '../src/client/pages/Discover.tsx'), 'utf8');

const required = [
  [passagesSource, 'CREATE TABLE IF NOT EXISTS browsing_events', 'server can create browsing_events table'],
  [passagesSource, 'CREATE INDEX IF NOT EXISTS browsing_events_user_created_idx', 'latest-event queries are indexed'],
  [passagesSource, "const VALID_INTERACTION_SOURCES = new Set(['discover', 'push_inbox'])", 'source names are normalized'],
  [passagesSource, "recordInteraction(prisma, userId, skipPassageId, 'skip', 'discover')", 'Discover skips write negative telemetry'],
  [passagesSource, "recordInteraction(prisma, userId, passage.id, 'view', 'discover')", 'Discover views write browsing telemetry'],
  [passagesSource, "recordInteraction(prisma, userId, recentPush.passageId, 'view', 'push_inbox')", 'push inbox reads write push_inbox telemetry'],
  [passagesSource, "recordInteraction(prisma, userId, passage.id, 'view', 'push_inbox')", 'exact push clicks write push_inbox telemetry'],
  [passagesSource, 'new Date()', 'DateTime writes use Date objects that Prisma/libSQL serializes as ISO text'],
  [discoverSource, 'apiFetch(`/passages/random${query}`)', 'authenticated Discover random calls include API token'],
  [discoverSource, 'apiFetch(`/passages/${encodeURIComponent(passageId)}${query}`)', 'authenticated pushed passage calls include API token'],
];

for (const [source, token, label] of required) {
  if (!source.includes(token)) {
    throw new Error(`Browsing events policy missing: ${label} (${token})`);
  }
}

console.log('browsing events policy check passed: discover and push-inbox reads feed browsing_events');
