#!/usr/bin/env node
/**
 * tag-passages.mjs — PLANET-1173
 *
 * Find all passages where tags is empty (`[]` / '' / NULL) and ask Gemini Flash
 * to produce 4-7 normalized tags per passage. Writes results back as JSON
 * stringified array (matches existing schema where tags is a TEXT column
 * containing JSON like ["fiction","classic","zh","novel"]).
 *
 * Tag schema (free-form but normalized):
 *   - genre: fiction | nonfiction | poetry | philosophy | history | religion | science | drama | essay | memoir | letters
 *   - mood: contemplative | melancholy | uplifting | tense | romantic | humorous | dark | serene | passionate
 *   - topic: war | love | death | nature | politics | family | friendship | identity | morality | art | travel | work | God | suffering | freedom | etc.
 *   - language: en | zh | ja | fr | de | es | other
 *   - difficulty (optional): easy | medium | hard
 *
 * Output is always lowercase, max 7 tags, must include at least one genre,
 * one mood, one topic, and the language code.
 *
 * Usage:
 *   pnpm node scripts/tag-passages.mjs                  # tag all empty
 *   pnpm node scripts/tag-passages.mjs --limit 50       # tag first 50 empty
 *   pnpm node scripts/tag-passages.mjs --dry-run        # show but do not write
 *   pnpm node scripts/tag-passages.mjs --batch 8        # passages per LLM call (default 5)
 *
 * Env:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   GEMINI_API_KEY  (or GEMINI_API_KEY_IMAGE_GENERATION_ONLY as fallback)
 */
import { createClient } from '@libsql/client';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (k) => process.argv.includes(k);

const LIMIT = arg('--limit') ? Number(arg('--limit')) : null;
const BATCH = arg('--batch') ? Number(arg('--batch')) : 5;
const DRY = has('--dry-run');
const MODEL = arg('--model') || 'gemini-2.5-flash';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const geminiKey =
  process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_IMAGE_GENERATION_ONLY;

if (!url || !authToken) {
  console.error('[tag] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing.');
  process.exit(1);
}
if (!geminiKey) {
  console.error('[tag] GEMINI_API_KEY missing.');
  process.exit(1);
}

const db = createClient({ url, authToken });

const SYSTEM_PROMPT = `You are tagging short literary passages for a personalized book-discovery engine.

For each passage produce 4-7 lowercase tags drawn from these axes:
  • genre: fiction | nonfiction | poetry | philosophy | history | religion | science | drama | essay | memoir | letters | biography
  • mood:  contemplative | melancholy | uplifting | tense | romantic | humorous | dark | serene | passionate | reflective | bleak | hopeful
  • topic: war | love | death | nature | politics | family | friendship | identity | morality | art | travel | work | god | suffering | freedom | knowledge | power | youth | aging | beauty | (anything specific & lowercase)
  • language: en | zh | ja | fr | de | es | other
  • difficulty (optional): easy | medium | hard

Rules:
  - Always include exactly one genre, one mood, at least one topic, and the language code.
  - All tags lowercase, no spaces inside a tag (use a single word; multi-word topics like "self-knowledge" use a hyphen).
  - 4-7 tags total per passage.
  - Output ONLY a JSON array of objects: [{"id":"<id>","tags":["..."]}, ...]. No markdown, no commentary.`;

function detectLang(text) {
  // crude but effective for our corpus (en + zh)
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk > text.length * 0.2) return 'zh';
  return 'en';
}

async function callGemini(passages) {
  const userBlock = passages
    .map((p) => `id=${p.id} | lang=${detectLang(p.text)} | book="${p.book_title}" | author="${p.author}"\n${p.text.slice(0, 1200)}`)
    .join('\n\n---\n\n');

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: `Tag these ${passages.length} passages:\n\n${userBlock}` }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON: ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Gemini response is not an array');
  return parsed;
}

// Fetch untagged passages.
const sql = `
  SELECT id, text, book_title, author, language
  FROM passages
  WHERE tags = '[]' OR tags = '' OR tags IS NULL
  ORDER BY id
  ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ''}
`;
const rows = (await db.execute(sql)).rows;
console.log(`[tag] passages to tag: ${rows.length} (batch=${BATCH}, model=${MODEL}, dry=${DRY})`);

let okCount = 0;
let failCount = 0;
let langFixCount = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const idx = `${i + 1}-${Math.min(i + BATCH, rows.length)}/${rows.length}`;

  let tagged;
  try {
    tagged = await callGemini(batch);
  } catch (e) {
    console.error(`[tag] batch ${idx} FAILED: ${e.message}`);
    failCount += batch.length;
    continue;
  }

  // Map id -> tags
  const byId = new Map();
  for (const t of tagged) {
    if (t && typeof t.id === 'string' && Array.isArray(t.tags)) {
      const clean = t.tags
        .map((x) => String(x).toLowerCase().trim())
        .filter((x) => x && x.length <= 30)
        .slice(0, 7);
      byId.set(String(t.id), clean);
    }
  }

  for (const p of batch) {
    const tags = byId.get(String(p.id));
    if (!tags || tags.length < 3) {
      console.error(`[tag]   ✗ ${p.id} — no/insufficient tags returned`);
      failCount++;
      continue;
    }
    // Fix language column too if Gemini gave us a language tag.
    const langTag = tags.find((t) => ['en', 'zh', 'ja', 'fr', 'de', 'es', 'other'].includes(t));
    const detectedLang = langTag || detectLang(p.text);

    if (DRY) {
      console.log(`[tag]   ✓ ${p.id} (${detectedLang}) → ${JSON.stringify(tags)}`);
      okCount++;
      continue;
    }
    try {
      await db.execute({
        sql: `UPDATE passages SET tags = ?, language = ? WHERE id = ?`,
        args: [JSON.stringify(tags), detectedLang, p.id],
      });
      if (detectedLang !== p.language) langFixCount++;
      okCount++;
    } catch (e) {
      console.error(`[tag]   ✗ ${p.id} DB write failed: ${e.message}`);
      failCount++;
    }
  }

  console.log(
    `[tag] batch ${idx} — ok=${okCount} fail=${failCount} (langFixed=${langFixCount})`,
  );
}

console.log(
  `\n[tag] ✅ DONE — tagged=${okCount}, failed=${failCount}, language column updates=${langFixCount}`,
);
