#!/usr/bin/env node

/**
 * Internet Archive OCR fetch-to-passages pilot — PLANET-2502
 *
 * Small, serial fetchability evaluation for public-domain-ish IA text items.
 * It intentionally does not ingest production data or build a crawler.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;
const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SUCCESS = 5;
const DEFAULT_MIN_PASSAGES = 50;
const USER_AGENT = 'RandomPage/1.0 IA OCR pilot (small evaluation; contact gotexis+claw@gmail.com)';

const SEARCHES = [
  { topic: 'philosophy', query: 'subject:philosophy OR title:philosophy' },
  { topic: 'psychology', query: 'subject:psychology OR title:psychology' },
  { topic: 'history', query: 'subject:history OR title:history' },
  { topic: 'literature', query: 'subject:literature OR title:literature' },
  { topic: 'essays', query: 'subject:essays OR title:essays' },
];

const args = parseArgs(process.argv.slice(2));
const limit = Number(args.limit || DEFAULT_LIMIT);
const cacheDir = path.resolve(APP_ROOT, args.cache || '.cache/ia-ocr-pilot');
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/ia-ocr-pilot-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/ia-ocr-pilot-samples.json');

function parseArgs(argv) {
  const parsed = { refresh: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  throw new Error('unreachable fetch retry state');
}

async function fetchJson(url) {
  const body = await fetchText(url);
  return JSON.parse(body);
}

async function cachedText(cacheName, url) {
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, cacheName);
  if (!args.refresh && existsSync(filePath)) return readFile(filePath, 'utf8');
  const text = await fetchText(url);
  await writeFile(filePath, text);
  await sleep(250);
  return text;
}

async function advancedSearch(search) {
  const params = new URLSearchParams({
    q: `collection:(internetarchivebooks) AND mediatype:(texts) AND date:[1800 TO 1927] AND (${search.query})`,
    fl: 'identifier,title,creator,date,downloads',
    rows: '20',
    page: '1',
    sort: 'downloads desc',
    output: 'json',
  });
  const json = await fetchJson(`https://archive.org/advancedsearch.php?${params}`);
  return (json.response?.docs || []).map((doc) => ({ ...doc, topic: search.topic }));
}

async function chooseItems() {
  if (args.ids) {
    return String(args.ids)
      .split(',')
      .map((identifier) => ({ identifier: identifier.trim(), topic: 'manual' }))
      .filter((item) => item.identifier)
      .slice(0, limit);
  }

  const perTopic = [];
  for (const search of SEARCHES) {
    perTopic.push(await advancedSearch(search));
    await sleep(250);
  }

  const seenIds = new Set();
  const seenTitles = new Set();
  const selected = [];
  let cursor = 0;
  while (selected.length < limit && perTopic.some((docs) => cursor < docs.length)) {
    for (const docs of perTopic) {
      const doc = docs[cursor];
      if (!doc?.identifier || seenIds.has(doc.identifier)) continue;
      if (looksModernTitle(doc.title)) continue;
      const titleKey = normalizeTitle(doc.title || doc.identifier);
      if (titleKey && seenTitles.has(titleKey)) continue;
      seenIds.add(doc.identifier);
      if (titleKey) seenTitles.add(titleKey);
      selected.push(doc);
      if (selected.length >= limit) break;
    }
    cursor += 1;
  }
  return selected.slice(0, limit);
}

function looksModernTitle(title) {
  return /\b(?:19[3-9]\d|20\d\d)\b/.test(String(title || ''));
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function findTextFile(metadata) {
  const files = metadata.files || [];
  const scored = files
    .filter((file) => file.name && /\.txt$/i.test(file.name))
    .map((file) => {
      let score = 0;
      if (/_djvu\.txt$/i.test(file.name)) score += 20;
      if (/(abbyy|ocr|text)/i.test(file.name)) score += 10;
      if (/meta|files|reviews/i.test(file.name)) score -= 50;
      score += Math.min(Number(file.size || 0) / 100000, 5);
      return { file, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.file || null;
}

function cleanOcrText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/^\s*This is a digital copy of a book.*$/gim, '')
    .replace(/^\s*Generated by .*$/gim, '')
    .replace(/^\s*Digitized by .*$/gim, '')
    .replace(/^\s*Google\s*$/gim, '')
    .replace(/^\s*Internet Archive\s*$/gim, '')
    .replace(/^\s*The Library of Congress.*$/gim, '')
    .replace(/^\s*Copyright(ed)? material.*$/gim, '')
    .replace(/\f/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => {
      if (!line) return true;
      if (/^\d+$/.test(line)) return false;
      if (/^[^A-Za-z]{1,12}$/.test(line)) return false;
      if (/^(chapter|section|book)\s+[ivxlcdm\d]+\.?$/i.test(line)) return true;
      if (line.length < 3) return false;
      return true;
    })
    .join('\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isLikelyReferenceNoteFragment(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.startsWith('↩')) return true;
  if (/^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i.test(normalized)) return true;
  if (/^(?:for\s+.{1,80},\s*)?(?:see|cf\.)\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b/i.test(normalized)) return true;
  return ((normalized.slice(0, 220).match(/(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi) ?? []).length >= 3);
}

function isLikelyChapterListFragment(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const chapterMatches = normalized.match(/(?:^|[\s.;:!?。！？])(?:chapter|chap\.|book|part|section)\s+(?:[0-9ivxlcdm]+|[a-z][a-z'’-]{1,30})(?=[\s.:;,-])/gi) ?? [];
  if (chapterMatches.length < 4) return false;
  const proseWords = normalized.match(/\b(?:the|and|but|for|with|from|that|this|they|their|there|then|when|where|while|into|upon|because|said|was|were|had|have|will|would|could|should|not)\b/gi) ?? [];
  const proseRatio = proseWords.length / Math.max(1, normalized.split(/\s+/).length);
  return chapterMatches.length >= 6 || proseRatio < 0.18;
}

function hasTerminalSentencePunctuation(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return /[.!?…。！？]["'”’）)\]》」』]*$/.test(normalized);
}

function splitOnSentenceBoundaries(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const matches = normalized.match(/[^.!?…。！？]+[.!?…。！？]["'”’）)\]》」』]*/g) || [];
  return matches.map((part) => part.trim()).filter(Boolean);
}

function isReadableTextCandidate(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length < MIN_PASSAGE_CHARS || normalized.length > MAX_PASSAGE_CHARS) return false;
  if (!hasTerminalSentencePunctuation(normalized)) return false;
  if (isLikelyReferenceNoteFragment(normalized)) return false;
  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  return letters / normalized.length > 0.55;
}

function sentenceBoundaryChunks(text) {
  const units = splitOnSentenceBoundaries(text).filter((unit) => unit.length <= MAX_PASSAGE_CHARS && !isLikelyReferenceNoteFragment(unit) && !isLikelyChapterListFragment(unit));
  const chunks = [];
  let buffer = '';
  for (const unit of units) {
    const next = buffer ? `${buffer} ${unit}` : unit;
    if (next.length <= MAX_PASSAGE_CHARS) {
      buffer = next;
      if (buffer.length >= TARGET_PASSAGE_CHARS) {
        if (isReadableTextCandidate(buffer)) chunks.push(buffer);
        buffer = '';
      }
      continue;
    }
    if (isReadableTextCandidate(buffer)) chunks.push(buffer);
    buffer = unit;
    if (buffer.length >= TARGET_PASSAGE_CHARS) {
      if (isReadableTextCandidate(buffer)) chunks.push(buffer);
      buffer = '';
    }
  }
  if (isReadableTextCandidate(buffer)) chunks.push(buffer);
  return chunks;
}

function slicePassages(text, maxPassages = 500) {
  const paragraphs = text
    .split(/\n+/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0 && !isLikelyReferenceNoteFragment(p) && !isLikelyChapterListFragment(p));
  const passages = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const candidates = paragraph.length <= MAX_PASSAGE_CHARS ? [paragraph] : sentenceBoundaryChunks(paragraph);
    for (const candidate of candidates) {
      if (!hasTerminalSentencePunctuation(candidate) || isLikelyReferenceNoteFragment(candidate) || isLikelyChapterListFragment(candidate)) continue;
      const next = buffer ? `${buffer}\n\n${candidate}` : candidate;
      if (next.length < TARGET_PASSAGE_CHARS) {
        buffer = next;
        continue;
      }
      if (isReadableTextCandidate(next)) {
        passages.push(next);
        buffer = '';
      } else if (isReadableTextCandidate(buffer)) {
        passages.push(buffer);
        buffer = candidate;
      } else {
        buffer = candidate;
      }
      if (passages.length >= maxPassages) break;
    }
    if (passages.length >= maxPassages) break;
  }
  if (passages.length < maxPassages && isReadableTextCandidate(buffer)) passages.push(buffer);
  return passages.slice(0, maxPassages);
}

function valueAsString(value) {
  if (Array.isArray(value)) return value.join('; ');
  return value == null ? '' : String(value);
}

async function evaluateItem(item) {
  const metadata = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(item.identifier)}`);
  const textFile = findTextFile(metadata);
  const title = valueAsString(metadata.metadata?.title || item.title || item.identifier);
  const author = valueAsString(metadata.metadata?.creator || item.creator || 'Unknown');
  if (!textFile) {
    return { identifier: item.identifier, topic: item.topic, title, author, status: 'failed', reason: 'no .txt OCR/plaintext file in IA metadata' };
  }
  const fileUrl = `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(textFile.name)}`;
  const raw = await cachedText(`${item.identifier}.txt`, fileUrl);
  const clean = cleanOcrText(raw);
  const passages = slicePassages(clean);
  return {
    identifier: item.identifier,
    topic: item.topic,
    title,
    author,
    status: passages.length > 0 ? 'success' : 'failed',
    reason: passages.length > 0 ? null : 'text fetched but cleaner/slicer produced no readable passages',
    file: textFile.name,
    sourceUrl: fileUrl,
    rawChars: raw.length,
    cleanChars: clean.length,
    passageCount: passages.length,
    avgPassageChars: passages.length ? Math.round(passages.reduce((sum, p) => sum + p.length, 0) / passages.length) : 0,
    samplePassages: passages.slice(0, 2),
  };
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : '0%';
}

function markdownReport(results) {
  const successes = results.filter((r) => r.status === 'success');
  const totalPassages = successes.reduce((sum, r) => sum + r.passageCount, 0);
  const avgCleanChars = successes.length ? Math.round(successes.reduce((sum, r) => sum + r.cleanChars, 0) / successes.length) : 0;
  const meetsGate = successes.length >= DEFAULT_MIN_SUCCESS && totalPassages >= DEFAULT_MIN_PASSAGES;
  const recommendation = meetsGate
    ? 'Create a follow-up Engineer ticket to turn this into a guarded small-batch IA OCR ingestion path (still serial, rate-limited, and review-first), reusing the existing passage content/length checks before any production insert.'
    : 'Do not ingest IA OCR yet; improve item selection and OCR cleanup, then rerun the pilot.';

  const lines = [
    '# PLANET-2502 — Internet Archive OCR fetch-to-passages pilot',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Command',
    '',
    '```bash',
    'pnpm --filter @randompage/app pilot:ia-ocr -- --limit 10',
    '```',
    '',
    '## Summary',
    '',
    `- Items evaluated: ${results.length}`,
    `- Successes: ${successes.length}/${results.length} (${pct(successes.length, results.length)})`,
    `- Candidate passages: ${totalPassages}`,
    `- Average clean-text chars among successes: ${avgCleanChars}`,
    `- Gate: at least ${DEFAULT_MIN_SUCCESS}/10 successes and >=${DEFAULT_MIN_PASSAGES} passages → ${meetsGate ? 'PASS' : 'FAIL'}`,
    '',
    '## Item results',
    '',
    '| # | Topic | Identifier | Title | Author | Status | Clean chars | Passages | Notes |',
    '|---:|---|---|---|---|---|---:|---:|---|',
  ];

  results.forEach((r, idx) => {
    lines.push(`| ${idx + 1} | ${r.topic || ''} | ${r.identifier} | ${escapeMd(r.title)} | ${escapeMd(r.author)} | ${r.status} | ${r.cleanChars || 0} | ${r.passageCount || 0} | ${escapeMd(r.reason || r.file || '')} |`);
  });

  lines.push(
    '',
    '## Quality notes',
    '',
    '- IA metadata lookup plus `_djvu.txt`/OCR plaintext download is enough to produce RandomPage-sized passages for the successful items.',
    '- OCR quality varies by scan; common cleanup needs are page numbers, digitization boilerplate, hyphenated line breaks, and footnote/reference-note fragments.',
    '- The pilot uses the existing RandomPage passage bounds: target ~300 chars, accepted 180–800 chars, sentence-terminal endings only.',
    '- This run only writes local cache/report artifacts; it does not insert rows into Turso.',
    '',
    '## Rate-limit / retry approach',
    '',
    '- Serial requests only, with a descriptive User-Agent.',
    '- 250ms delay between cached text downloads/search groups.',
    '- Retries only for 429/5xx responses, with short linear backoff.',
    '- Future ingestion should keep small batches and persist item-level failures before scaling.',
    '',
    '## Recommendation',
    '',
    recommendation,
    '',
    '## Sample passages',
    '',
  );

  for (const r of successes.slice(0, 5)) {
    lines.push(`### ${r.title} — ${r.author}`, '', `IA: https://archive.org/details/${r.identifier}`, '');
    for (const sample of r.samplePassages || []) {
      lines.push(`> ${sample.replace(/\n+/g, ' ')}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
}

async function main() {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const items = await chooseItems();
  const results = [];
  for (const item of items) {
    try {
      const result = await evaluateItem(item);
      results.push(result);
      console.error(`${result.status === 'success' ? 'ok' : 'fail'} ${result.identifier}: ${result.passageCount || 0} passages`);
    } catch (err) {
      results.push({ identifier: item.identifier, topic: item.topic, title: item.title || item.identifier, author: valueAsString(item.creator), status: 'failed', reason: err.message });
      console.error(`fail ${item.identifier}: ${err.message}`);
    }
    await sleep(250);
  }

  const report = markdownReport(results);
  await writeFile(reportPath, report);
  await writeFile(sampleJsonPath, `${JSON.stringify(results, null, 2)}\n`);

  const successes = results.filter((r) => r.status === 'success').length;
  const passages = results.reduce((sum, r) => sum + (r.passageCount || 0), 0);
  const summary = { items: results.length, successes, passages, report: path.relative(process.cwd(), reportPath), samples: path.relative(process.cwd(), sampleJsonPath) };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`IA_OCR_PILOT items=${summary.items} successes=${summary.successes} passages=${summary.passages} report=${summary.report}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
