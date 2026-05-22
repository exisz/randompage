#!/usr/bin/env node
/**
 * Fails when production contains known protected/modern-book full-text passages.
 * Use --apply only for reviewed quarantines/deletions with no user refs.
 */
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('[source-policy] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing.');
  process.exit(1);
}

const db = createClient({ url, authToken });

const blockedSources = [
  { title: 'It Ends With Us', author: 'Colleen Hoover', reason: 'protected modern-book full text; not public-domain/licensed for RandomPage passage cache' },
];

const violations = [];
for (const source of blockedSources) {
  const result = await db.execute({
    sql: `SELECT p.id, p.book_title, p.author,
            (SELECT COUNT(*) FROM bookmarks WHERE passage_id = p.id) AS bookmarks,
            (SELECT COUNT(*) FROM push_history WHERE passage_id = p.id) AS push_history
          FROM passages p
          WHERE lower(p.book_title) = lower(?) OR lower(p.author) = lower(?)
          ORDER BY p.id`,
    args: [source.title, source.author],
  });
  for (const row of result.rows) violations.push({ ...source, ...row });
}

if (!violations.length) {
  console.log('[source-policy] ok: no known protected full-text passages found');
  process.exit(0);
}

console.log(`[source-policy] violations: ${violations.length}`);
for (const row of violations) {
  console.log(`- ${row.id} :: ${row.book_title} — ${row.author} (bookmarks=${row.bookmarks}, push_history=${row.push_history}) :: ${row.reason}`);
}

if (!APPLY) {
  console.error('[source-policy] failed: rerun with --apply only after confirming rows are safe to delete');
  process.exit(1);
}

const unsafe = violations.filter((row) => Number(row.bookmarks) > 0 || Number(row.push_history) > 0);
if (unsafe.length) {
  console.error(`[source-policy] refusing --apply: ${unsafe.length} violation(s) have user refs`);
  process.exit(1);
}

const ids = violations.map((row) => row.id);
const placeholders = ids.map(() => '?').join(',');
const deleted = await db.execute({ sql: `DELETE FROM passages WHERE id IN (${placeholders})`, args: ids });
console.log(`[source-policy] deleted protected passage rows: ${deleted.rowsAffected}`);
