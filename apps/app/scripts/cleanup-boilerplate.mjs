#!/usr/bin/env node
/**
 * cleanup-boilerplate.mjs — PLANET-1172
 *
 * Scan passages table for Standard-Ebooks / Project Gutenberg boilerplate and
 * delete those rows. By default runs DRY-RUN; pass --apply to actually delete.
 *
 * Patterns matched (case-insensitive):
 *   - 'Standard Ebooks is'
 *   - 'This ebook is the product of many hours'
 *   - 'public domain' (when paired with 'ebook' / 'transcription')
 *   - text starting with 'By <Author>.' followed by 'Translated by' / ebook metadata
 *   - lines that are essentially 'Translated by ...' on their own
 *
 * Safety: never deletes rows that have bookmarks or push_history references —
 * those rows are reported but skipped (manual review).
 *
 * Usage:
 *   pnpm node scripts/cleanup-boilerplate.mjs              # dry run
 *   pnpm node scripts/cleanup-boilerplate.mjs --apply      # actually delete
 *   pnpm node scripts/cleanup-boilerplate.mjs --apply --force-refs   # also clean push_history refs (NOT bookmarks)
 *
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const FORCE_REFS = process.argv.includes('--force-refs');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('[cleanup] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing.');
  process.exit(1);
}

const db = createClient({ url, authToken });

// SQL pre-filter — pulls rows that look suspicious so we don't fetch all 600+.
const CANDIDATE_SQL = `
  SELECT id, text, book_title, author
  FROM passages
  WHERE text LIKE '%Standard Ebooks%'
     OR text LIKE '%This ebook is the product of many hours%'
     OR text LIKE '%Project Gutenberg%'
     OR text LIKE '%transcription from Project Gutenberg%'
     OR text LIKE '%digital scans from the Internet Archive%'
     OR text LIKE '%volunteer-driven project%'
     OR (text LIKE 'By %' AND text LIKE '%Translated by%' AND length(text) < 800)
`;

// In-memory boilerplate test (run on candidates, returns reason or null).
function classify(text) {
  const t = (text || '').trim();
  const lower = t.toLowerCase();

  if (lower.includes('standard ebooks is a volunteer-driven project'))
    return 'Standard Ebooks self-description';
  if (lower.includes('volunteer-driven standard ebooks'))
    return 'Standard Ebooks self-description (alt)';
  if (lower.includes('this ebook is the product of many hours'))
    return 'Standard Ebooks volunteer credit';
  if (lower.includes('standard ebooks makes no representations'))
    return 'Standard Ebooks copyright disclaimer';
  if (lower.includes('first edition of this ebook was released'))
    return 'Standard Ebooks revision/release notice';
  if (lower.includes('check for updates to this ebook'))
    return 'Standard Ebooks update notice';
  if (
    lower.includes('transcription from project gutenberg') ||
    lower.includes('digital scans from the internet archive')
  )
    return 'Project Gutenberg / IA provenance notice';
  // "By Author. Translated by X. <ebook metadata>" pattern
  if (
    /^By [^.]{2,80}\.\s+Translated by /i.test(t) &&
    (lower.includes('ebook') || lower.includes('public domain'))
  )
    return 'Author/Translator + ebook metadata';
  // Pure attribution line, very short
  if (/^Translated by [^.]{2,120}\.?$/i.test(t)) return 'Standalone "Translated by" line';
  if (/^By [A-Z][^.]{2,120}\.?$/.test(t) && t.length < 120) return 'Standalone author byline';
  return null;
}

console.log(`[cleanup] mode = ${APPLY ? 'APPLY (will delete)' : 'DRY RUN (no changes)'}`);
const candRes = await db.execute(CANDIDATE_SQL);
console.log(`[cleanup] candidates from SQL pre-filter: ${candRes.rows.length}`);

const toDelete = [];
const skipped = [];
for (const row of candRes.rows) {
  const reason = classify(row.text);
  if (!reason) continue;

  // Safety: check for FK references.
  const refs = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM bookmarks WHERE passage_id = ?) AS bm,
            (SELECT COUNT(*) FROM push_history WHERE passage_id = ?) AS ph`,
    args: [row.id, row.id],
  });
  const { bm, ph } = refs.rows[0];
  // Bookmarks = user explicitly saved → never delete (would corrupt their library).
  if (Number(bm) > 0) {
    skipped.push({ id: row.id, reason, bm: Number(bm), ph: Number(ph), why: 'has bookmarks' });
    continue;
  }
  // push_history = noise; with --force-refs we cascade-delete history rows then the passage.
  if (Number(ph) > 0 && !FORCE_REFS) {
    skipped.push({ id: row.id, reason, bm: Number(bm), ph: Number(ph), why: 'has push_history (use --force-refs)' });
    continue;
  }
  toDelete.push({ id: row.id, reason, snippet: String(row.text).slice(0, 100), book: row.book_title });
}

console.log(`\n[cleanup] would delete: ${toDelete.length} rows`);
console.log(`[cleanup] skipped (has refs): ${skipped.length} rows`);

const byReason = toDelete.reduce((acc, r) => ((acc[r.reason] = (acc[r.reason] || 0) + 1), acc), {});
console.log('\n[cleanup] reason breakdown:');
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.toString().padStart(4)}  ${k}`);
}

console.log('\n[cleanup] sample (first 5):');
for (const r of toDelete.slice(0, 5)) {
  console.log(`  - ${r.id} [${r.book}] :: ${r.snippet}`);
}

if (skipped.length) {
  console.log('\n[cleanup] SKIPPED (review manually):');
  for (const s of skipped) console.log(`  - ${s.id} (${s.reason}) bm=${s.bm} ph=${s.ph} — ${s.why}`);
}

if (!APPLY) {
  console.log('\n[cleanup] DRY RUN — re-run with --apply to delete.');
  process.exit(0);
}

if (!toDelete.length) {
  console.log('\n[cleanup] nothing to delete.');
  process.exit(0);
}

// Batch delete (Turso has a stmt count limit per request — use chunks of 100).
const ids = toDelete.map((r) => r.id);
let deleted = 0;
let historyDeleted = 0;
const CHUNK = 100;
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const placeholders = chunk.map(() => '?').join(',');
  if (FORCE_REFS) {
    const hres = await db.execute({
      sql: `DELETE FROM push_history WHERE passage_id IN (${placeholders})`,
      args: chunk,
    });
    historyDeleted += Number(hres.rowsAffected || 0);
  }
  const res = await db.execute({
    sql: `DELETE FROM passages WHERE id IN (${placeholders})`,
    args: chunk,
  });
  deleted += Number(res.rowsAffected || 0);
  console.log(`[cleanup] deleted batch ${i / CHUNK + 1}: ${res.rowsAffected} passage rows${FORCE_REFS ? ` (+ history rows in this chunk)` : ''}`);
}
if (FORCE_REFS) console.log(`[cleanup] cascade-deleted push_history rows: ${historyDeleted}`);
console.log(`\n[cleanup] ✅ DONE — deleted ${deleted} rows`);

const after = await db.execute('SELECT COUNT(*) AS n FROM passages');
console.log(`[cleanup] passages remaining: ${after.rows[0].n}`);
