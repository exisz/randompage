#!/usr/bin/env node

/**
 * Open Library Search Inside / Internet Archive text fetchability evaluation — PLANET-3169.
 *
 * This is a local evaluation only. It does not write production data, does not
 * import full books, and only emits small RandomPage-style candidate passages
 * from openly readable IA OCR/plaintext files when a direct text file is
 * fetchable without login. Search Inside snippets are recorded as snippets.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const USER_AGENT = 'RandomPage/1.0 OpenLibrary Search Inside eval (local PLANET-3169; contact gotexis+claw@gmail.com)';
const DEFAULT_TOPICS = ['philosophy', 'psychology', 'history', 'literature', 'classics'];
const MIN_CHARS = 450;
const TARGET_WORDS = 300;
const MAX_CHARS = 2200;

const args = parseArgs(process.argv.slice(2));
const topics = String(args.topics || DEFAULT_TOPICS.join(','))
  .split(',')
  .map((topic) => topic.trim())
  .filter(Boolean);
const perTopic = clamp(Number(args.perTopic || args['per-topic'] || 8), 1, 20);
const maxTextFetches = clamp(Number(args.maxTextFetches || args['max-text-fetches'] || 20), 0, 50);
const maxCandidates = clamp(Number(args.maxCandidates || args['max-candidates'] || 20), 1, 80);
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/openlibrary-search-inside-eval-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/openlibrary-search-inside-eval-samples.json');

function parseArgs(argv) {
  const parsed = {};
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text) {
  return String(text || '')
    .replace(/\{\{\{/g, '')
    .replace(/\}\}\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function fetchWithRetry(url, { accept = '*/*', retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept,
        'user-agent': USER_AGENT,
      },
    });
    if (response.ok) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  throw new Error('unreachable retry state');
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, { accept: 'application/json' });
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, { accept: 'text/plain,*/*' });
  return response.text();
}

async function searchInside(topic) {
  const url = new URL('https://openlibrary.org/search/inside.json');
  url.searchParams.set('q', topic);
  url.searchParams.set('limit', String(perTopic));
  const json = await fetchJson(url);
  const rows = json.hits?.hits || [];
  return rows.map((hit, index) => {
    const edition = hit.edition || {};
    const availability = hit.availability || edition.availability || {};
    const title = first(hit.fields?.meta_title) || edition.title || 'Untitled';
    const author = first(hit.fields?.meta_creator) || first(edition.authors)?.name || 'Unknown';
    const identifier = first(hit.fields?.identifier) || availability.identifier || edition.ocaid || null;
    const snippets = (hit.highlight?.text || []).map(cleanText).filter(Boolean).slice(0, 3);
    return {
      topic,
      rank: index + 1,
      title,
      author,
      olid: edition.key || null,
      iaIdentifier: identifier,
      year: first(hit.fields?.meta_year) || null,
      snippetLength: snippets.reduce((sum, snippet) => sum + snippet.length, 0),
      snippets,
      readApi: {
        status: availability.status || null,
        isReadable: Boolean(availability.is_readable),
        isPreviewable: Boolean(availability.is_previewable),
        isLendable: Boolean(availability.is_lendable),
        availableToBorrow: Boolean(availability.available_to_borrow),
        availableToBrowse: Boolean(availability.available_to_browse),
      },
      sourceUrl: edition.url ? `https://openlibrary.org${edition.url}` : 'https://openlibrary.org/search/inside',
    };
  });
}

function isOpenDirectTextCandidate(record) {
  return Boolean(record.iaIdentifier)
    && record.readApi.status === 'open'
    && record.readApi.isReadable
    && !record.readApi.isLendable
    && !record.readApi.availableToBorrow;
}

async function findTextFile(identifier) {
  const metadata = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const files = metadata.files || [];
  const preferred = files.find((file) => /_djvu\.txt$/i.test(file.name))
    || files.find((file) => /\.txt$/i.test(file.name) && !/_meta\.txt$/i.test(file.name));
  if (!preferred) return null;
  return {
    name: preferred.name,
    size: Number(preferred.size || 0) || null,
    url: `https://archive.org/download/${encodeURIComponent(identifier)}/${preferred.name.split('/').map(encodeURIComponent).join('/')}`,
  };
}

function usableParagraph(paragraph) {
  const text = cleanText(paragraph);
  if (text.length < 90) return false;
  if (/^(contents|index|chapter\s+[ivxlcdm\d]+\s*$|footnotes?|notes?)$/i.test(text)) return false;
  if ((text.match(/\bchapter\b/gi) || []).length >= 3 && text.length < 800) return false;
  if (!/[.!?。！？”’)]$/.test(text)) return false;
  return true;
}

function choosePassage(text, topic) {
  const normalized = cleanText(text);
  const paragraphs = normalized
    .split(/\n\s*\n/g)
    .map(cleanText)
    .filter(usableParagraph);
  const topicLower = topic.toLowerCase();
  const topicIndex = paragraphs.findIndex((paragraph) => paragraph.toLowerCase().includes(topicLower));
  const start = topicIndex >= 0 ? topicIndex : 0;
  const words = [];
  for (const paragraph of paragraphs.slice(start)) {
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      words.push(word);
      const current = words.join(' ');
      if (words.length >= TARGET_WORDS && current.length >= MIN_CHARS) {
        return current.slice(0, MAX_CHARS).trim();
      }
      if (current.length >= MAX_CHARS) return current.slice(0, MAX_CHARS).trim();
    }
  }
  const fallback = paragraphs.slice(start, start + 4).join(' ').slice(0, MAX_CHARS).trim();
  return fallback.length >= MIN_CHARS ? fallback : null;
}

function scoreSummary(records, textAttempts, candidates) {
  const recordsReturned = records.length;
  const readable = records.filter((row) => row.readApi.isReadable).length;
  const openDirect = records.filter(isOpenDirectTextCandidate).length;
  const snippetRows = records.filter((row) => row.snippetLength > 0).length;
  const fetchSuccesses = textAttempts.filter((row) => row.success).length;
  const fetchFailures = textAttempts.filter((row) => !row.success).length;
  const passageYield = candidates.length;
  let verdict = 'C: not viable';
  if (passageYield >= 10 && fetchSuccesses >= 5) verdict = 'A: viable as a reviewed direct passage source for open IA OCR items';
  else if (snippetRows >= 10 && (readable > 0 || openDirect > 0)) verdict = 'B: viable for discovery/metadata/search snippets; direct passage use needs reviewed open-item fetches';
  return { recordsReturned, readable, openDirect, snippetRows, fetchSuccesses, fetchFailures, passageYield, verdict };
}

function markdownReport({ generatedAt, records, textAttempts, candidates, summary }) {
  const byTopic = topics.map((topic) => {
    const topicRecords = records.filter((row) => row.topic === topic);
    const topicCandidates = candidates.filter((row) => row.topic === topic);
    return `| ${topic} | ${topicRecords.length} | ${topicRecords.filter((row) => row.snippetLength > 0).length} | ${topicRecords.filter((row) => row.readApi.isReadable).length} | ${topicRecords.filter(isOpenDirectTextCandidate).length} | ${topicCandidates.length} |`;
  }).join('\n');

  const sampleRows = candidates.slice(0, 10).map((row) => (
    `| ${row.topic} | ${escapeMd(row.title)} | ${escapeMd(row.author)} | ${row.iaIdentifier} | ${row.passage.length} |`
  )).join('\n');

  const failures = textAttempts.filter((row) => !row.success).slice(0, 10).map((row) => `- ${row.identifier}: ${row.error}`).join('\n') || '- none in sampled attempts';

  return `# Open Library Search Inside passage-source pilot — PLANET-3169

Generated: ${generatedAt}

## Verdict

**${summary.verdict}**

Open Library Search Inside is useful as a high-coverage discovery surface: it returns topic-matched snippets, OL edition links, IA identifiers, and Read API availability signals for RandomPage preference topics. For production RandomPage passages, the safest smallest path is not blind import from Search Inside snippets; it is a reviewed pipeline that keeps Search Inside as discovery/ranking, then fetches direct IA OCR/plaintext only for openly readable identifiers and runs the existing passage cleaning policy before any tiny import.

## Counts

- queries run: ${topics.length} (${topics.join(', ')})
- records returned: ${summary.recordsReturned}
- records with snippets: ${summary.snippetRows}
- readable/full-access Read API links found: ${summary.readable}
- open direct-text candidates: ${summary.openDirect}
- direct IA text/OCR fetch successes: ${summary.fetchSuccesses}
- direct IA text/OCR fetch failures: ${summary.fetchFailures}
- usable RandomPage-style passage candidates emitted: ${summary.passageYield}

| topic | records | snippet rows | readable links | open direct candidates | usable passages |
|---|---:|---:|---:|---:|---:|
${byTopic}

## Source scoring

| dimension | score | note |
|---|---:|---|
| coverage | 8/10 | Search Inside returns multiple topic hits across all five preference topics. |
| content depth | ${summary.passageYield >= 10 ? '7/10' : '5/10'} | Snippets are short, but open IA OCR can yield full paragraphs when an openly readable identifier has a text file. |
| fetch stability | ${summary.fetchFailures === 0 ? '8/10' : '6/10'} | API worked serially with a conservative user-agent; direct text fetch depends on IA file availability. |
| rate-limit behavior | 7/10 | This pilot uses low-volume serial requests; any production workflow should keep throttling and caching metadata only. |
| cleaning complexity | 6/10 | OCR text needs the same boilerplate/reference-note/non-terminal filters already used by RandomPage. |
| passage yield | ${summary.passageYield >= 20 ? '8/10' : summary.passageYield >= 10 ? '6/10' : '4/10'} | ${summary.passageYield} usable candidates from ${summary.fetchSuccesses} successful direct text fetches in this small sample. |
| recommendation value | 7/10 | Topic search aligns with existing user goals and can expand book/source discovery without summaries or social feed scope. |

## Candidate samples

| topic | title | author | IA identifier | chars |
|---|---|---|---|---:|
${sampleRows || '| — | — | — | — | 0 |'}

Full sample metadata and candidate excerpts are in \`${path.relative(APP_ROOT, sampleJsonPath)}\`.

## Direct fetch failures sampled

${failures}

## Recommendation

Create a follow-up Gap for a reviewed Open Library → IA OCR candidate queue: Search Inside discovers title/author/OLID/IA identifiers for configured RandomPage topics, stores metadata/report only, and requires a reviewed allowlist before running the existing IA OCR ingest path. Keep production import separate from this evaluator; do not cache protected full text, do not turn RandomPage into a generic reader/feed, and do not generate summaries.
`;
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const records = [];
  for (const topic of topics) {
    const rows = await searchInside(topic);
    records.push(...rows);
    await sleep(350);
  }

  const seenIds = new Set();
  const directRecords = records.filter(isOpenDirectTextCandidate).filter((row) => {
    if (seenIds.has(row.iaIdentifier)) return false;
    seenIds.add(row.iaIdentifier);
    return true;
  }).slice(0, maxTextFetches);

  const textAttempts = [];
  const candidates = [];
  for (const record of directRecords) {
    try {
      const textFile = await findTextFile(record.iaIdentifier);
      if (!textFile) throw new Error('no IA plaintext/OCR .txt file found');
      await sleep(250);
      const text = await fetchText(textFile.url);
      const passage = choosePassage(text, record.topic);
      if (!passage) throw new Error('text fetched but no clean ~300-word passage candidate found');
      textAttempts.push({ identifier: record.iaIdentifier, success: true, textFile: textFile.name, bytes: textFile.size });
      candidates.push({
        topic: record.topic,
        title: record.title,
        author: record.author,
        olid: record.olid,
        iaIdentifier: record.iaIdentifier,
        sourceUrl: record.sourceUrl,
        textFile: textFile.name,
        passage,
        tags: [record.topic, 'openlibrary-search-inside-eval', 'ia-ocr-candidate'],
      });
      if (candidates.length >= maxCandidates) break;
    } catch (err) {
      textAttempts.push({ identifier: record.iaIdentifier, success: false, error: err.message });
    }
    await sleep(350);
  }

  const summary = scoreSummary(records, textAttempts, candidates);
  const payload = {
    generatedAt,
    policy: 'local evaluation only; no production writes; direct OCR candidate excerpts only from openly readable IA identifiers',
    topics,
    perTopic,
    maxTextFetches,
    summary,
    records: records.map((record) => ({
      ...record,
      // Keep JSON evidence compact: snippets prove Search Inside coverage,
      // while full passage candidates below come only from open direct text.
      snippets: record.snippets.slice(0, 2).map((snippet) => snippet.slice(0, 240)),
    })),
    textAttempts,
    candidates,
  };

  await mkdir(path.dirname(sampleJsonPath), { recursive: true });
  await writeFile(sampleJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(reportPath, markdownReport({ generatedAt, records, textAttempts, candidates, summary }));

  console.log(JSON.stringify({ reportPath, sampleJsonPath, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
