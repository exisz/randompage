#!/usr/bin/env node

/**
 * HathiTrust OCR/page-access evaluation — PLANET-3364.
 *
 * Local evaluation only: no Turso writes, no production import, no summaries.
 * It uses the HathiTrust Bibliographic API for metadata/access flags and then
 * attempts small serial page OCR fetches for selected volumes through the
 * documented PageTurner/Data API pageocr route.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const USER_AGENT = 'RandomPage/1.0 HathiTrust page-access eval (local PLANET-3364; contact gotexis+claw@gmail.com)';
const DEFAULT_PAGE_PROBES = [1, 5, 10, 25, 50, 100];
const MIN_CHARS = 450;
const TARGET_WORDS = 300;
const MAX_CHARS = 2200;

const DEFAULT_SEEDS = [
  { topic: 'philosophy', label: 'Meditations / Marcus Aurelius', idType: 'isbn', id: '0140449337' },
  { topic: 'philosophy', label: 'Republic / Plato', idType: 'isbn', id: '0872201368' },
  { topic: 'philosophy', label: 'Beyond Good and Evil / Nietzsche', idType: 'isbn', id: '014044923X' },
  { topic: 'psychology', label: 'Principles of Psychology / William James', idType: 'oclc', id: '1029815' },
  { topic: 'psychology', label: 'Interpretation of Dreams / Freud', idType: 'isbn', id: '0380010003' },
  { topic: 'psychology', label: 'Talks to Teachers on Psychology / William James', idType: 'oclc', id: '271802' },
  { topic: 'history', label: 'Peloponnesian War / Thucydides', idType: 'isbn', id: '0140440399' },
  { topic: 'history', label: 'Decline and Fall / Gibbon', idType: 'oclc', id: '2217038' },
  { topic: 'history', label: 'French Revolution / Carlyle', idType: 'oclc', id: '1328095' },
  { topic: 'literature', label: 'Pride and Prejudice / Austen', idType: 'oclc', id: '3865959' },
  { topic: 'literature', label: 'Hamlet / Shakespeare', idType: 'oclc', id: '1716920' },
  { topic: 'literature', label: 'Moby-Dick / Melville', idType: 'oclc', id: '270685' },
  { topic: 'classics', label: 'Iliad / Homer', idType: 'oclc', id: '1934975' },
  { topic: 'classics', label: 'Odyssey / Homer', idType: 'oclc', id: '1775384' },
  { topic: 'classics', label: 'Divine Comedy / Dante', idType: 'oclc', id: '732919' },
];

const args = parseArgs(process.argv.slice(2));
const maxSeeds = clamp(Number(args.maxSeeds || args['max-seeds'] || DEFAULT_SEEDS.length), 1, DEFAULT_SEEDS.length);
const maxVolumes = clamp(Number(args.maxVolumes || args['max-volumes'] || 15), 1, 30);
const maxPageProbes = clamp(Number(args.maxPageProbes || args['max-page-probes'] || 4), 1, DEFAULT_PAGE_PROBES.length);
const seeds = DEFAULT_SEEDS.slice(0, maxSeeds);
const pageProbes = DEFAULT_PAGE_PROBES.slice(0, maxPageProbes);
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/hathitrust-page-access-eval-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/hathitrust-page-access-eval-samples.json');

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

async function fetchWithRetry(url, { accept = '*/*', retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept, 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (response.ok) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 120).replace(/\s+/g, ' ')}` : ''}`);
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

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/This content downloaded from .*? on .*$/gim, '')
    .trim();
}

function usableParagraph(paragraph) {
  const text = cleanText(paragraph);
  if (text.length < 90) return false;
  if (/^(contents|index|chapter\s+[ivxlcdm\d]+\s*$|footnotes?|notes?|bibliography)$/i.test(text)) return false;
  if ((text.match(/\bchapter\b/gi) || []).length >= 3 && text.length < 800) return false;
  if (!/[.!?。！？”’)]$/.test(text)) return false;
  const letters = (text.match(/[A-Za-z\p{L}]/gu) || []).length;
  if (letters / Math.max(text.length, 1) < 0.45) return false;
  return true;
}

function choosePassage(pageTexts) {
  const paragraphs = cleanText(pageTexts.join('\n\n'))
    .split(/\n\s*\n/g)
    .map(cleanText)
    .filter(usableParagraph);
  const words = [];
  for (const paragraph of paragraphs) {
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      words.push(word);
      const current = words.join(' ');
      if (words.length >= TARGET_WORDS && current.length >= MIN_CHARS) return current.slice(0, MAX_CHARS).trim();
      if (current.length >= MAX_CHARS) return current.slice(0, MAX_CHARS).trim();
    }
  }
  const fallback = paragraphs.slice(0, 4).join(' ').slice(0, MAX_CHARS).trim();
  return fallback.length >= MIN_CHARS ? fallback : null;
}

function firstRecord(records) {
  const entries = Object.entries(records || {});
  if (!entries.length) return { recordId: null, record: {} };
  return { recordId: entries[0][0], record: entries[0][1] || {} };
}

function itemRank(item) {
  const rights = String(item.rightsCode || '').toLowerCase();
  const text = String(item.usRightsString || '').toLowerCase();
  if (rights === 'pd' || rights === 'pdus' || text.includes('full view')) return 0;
  if (rights === 'cc-by' || rights === 'cc0' || rights.startsWith('cc-')) return 1;
  if (text.includes('limited')) return 3;
  return 2;
}

function itemAccess(item) {
  const rights = String(item.rightsCode || '').toLowerCase();
  const usRightsString = String(item.usRightsString || '');
  return {
    rightsCode: item.rightsCode || null,
    usRightsString: item.usRightsString || null,
    fullViewLikely: rights === 'pd' || rights === 'pdus' || rights.startsWith('cc') || /full view/i.test(usRightsString),
    limitedSearchOnlyLikely: rights === 'ic' || /limited/i.test(usRightsString),
  };
}

async function lookupSeed(seed) {
  const url = `https://catalog.hathitrust.org/api/volumes/brief/${encodeURIComponent(seed.idType)}/${encodeURIComponent(seed.id)}.json`;
  const json = await fetchJson(url);
  const { recordId, record } = firstRecord(json.records);
  const items = (json.items || []).slice().sort((a, b) => itemRank(a) - itemRank(b));
  return {
    ...seed,
    metadataUrl: url,
    recordId,
    recordUrl: record.recordURL || null,
    title: record.titles?.[0] || seed.label,
    author: record.authors?.[0]?.name || null,
    publishDates: record.publishDates || [],
    oclcs: record.oclcs || [],
    lccns: record.lccns || [],
    itemCount: items.length,
    items,
  };
}

async function probeVolume(volume) {
  const pageAttempts = [];
  const pageTexts = [];
  for (const seq of pageProbes) {
    const url = `https://babel.hathitrust.org/htd/volume/pageocr/${encodeURIComponent(volume.htid)}/${seq}`;
    try {
      const text = cleanText(await fetchText(url));
      pageAttempts.push({ seq, url, success: true, status: 'ok', chars: text.length, sample: text.slice(0, 220) });
      if (text.length > 0) pageTexts.push(text);
    } catch (err) {
      pageAttempts.push({ seq, url, success: false, error: err.message });
    }
    await sleep(400);
  }
  const passage = choosePassage(pageTexts);
  return { pageAttempts, pageTextChars: pageTexts.reduce((sum, text) => sum + text.length, 0), passage };
}

function scoreSummary(seedResults, volumeResults, candidates) {
  const seedsTested = seedResults.length;
  const metadataSuccesses = seedResults.filter((row) => row.metadataSuccess).length;
  const volumesTested = volumeResults.length;
  const fullViewLikely = volumeResults.filter((row) => row.access.fullViewLikely).length;
  const pageTextSuccesses = volumeResults.filter((row) => row.pageAttempts.some((attempt) => attempt.success && attempt.chars > 0)).length;
  const accessFailures = volumeResults.filter((row) => row.pageAttempts.every((attempt) => !attempt.success)).length;
  const usablePassageCandidates = candidates.length;
  let verdict = 'C: not viable without authenticated/institutional or less-blocked OCR access';
  if (usablePassageCandidates >= 5 && pageTextSuccesses >= 5) verdict = 'A: viable direct passage source for reviewed full-view HathiTrust volumes';
  else if (metadataSuccesses >= Math.max(5, Math.floor(seedsTested * 0.6)) && pageTextSuccesses < 5) verdict = 'B: viable for metadata/access discovery; direct OCR/page text is not reliably obtainable unauthenticated in this environment';
  return { seedsTested, metadataSuccesses, volumesTested, fullViewLikely, pageTextSuccesses, accessFailures, usablePassageCandidates, verdict };
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function markdownReport({ generatedAt, seedResults, volumeResults, candidates, summary }) {
  const topicRows = [...new Set(seedResults.map((row) => row.topic))].map((topic) => {
    const seedsForTopic = seedResults.filter((row) => row.topic === topic);
    const volumesForTopic = volumeResults.filter((row) => row.topic === topic);
    return `| ${topic} | ${seedsForTopic.length} | ${seedsForTopic.filter((row) => row.metadataSuccess).length} | ${volumesForTopic.length} | ${volumesForTopic.filter((row) => row.access.fullViewLikely).length} | ${volumesForTopic.filter((row) => row.pageAttempts.some((attempt) => attempt.success)).length} | ${candidates.filter((row) => row.topic === topic).length} |`;
  }).join('\n');

  const volumeRows = volumeResults.map((row) => `| ${row.topic} | ${escapeMd(row.seedLabel)} | ${escapeMd(row.title)} | ${row.htid} | ${row.access.rightsCode || '—'} | ${escapeMd(row.access.usRightsString || '—')} | ${row.pageAttempts.filter((attempt) => attempt.success).length}/${row.pageAttempts.length} | ${row.pageTextChars} | ${row.passage ? 'yes' : 'no'} |`).join('\n');
  const failureRows = volumeResults.flatMap((row) => row.pageAttempts.filter((attempt) => !attempt.success).slice(0, 2).map((attempt) => `- ${row.htid} page ${attempt.seq}: ${attempt.error}`)).slice(0, 20).join('\n') || '- none in sampled attempts';
  const sampleRows = candidates.slice(0, 10).map((row) => `| ${row.topic} | ${escapeMd(row.title)} | ${row.htid} | ${row.passage.length} |`).join('\n') || '| — | — | — | 0 |';

  return `# HathiTrust OCR/page-access passage-source pilot — PLANET-3364

Generated: ${generatedAt}

## Verdict

**${summary.verdict}**

This evaluator treats HathiTrust as a possible high-scale book source, but only if page OCR/text is practically obtainable for reviewed volumes. It does not make a copyright/license decision and does not import anything into production. The measured question is operational: metadata coverage, public/full-view flags, unauthenticated OCR/page text access, cleaning complexity, and RandomPage-style passage yield.

## Counts

- candidate seeds tested: ${summary.seedsTested}
- HathiTrust metadata successes: ${summary.metadataSuccesses}
- candidate volumes tested for page OCR: ${summary.volumesTested}
- volumes marked full-view/public-likely: ${summary.fullViewLikely}
- OCR/page text successes: ${summary.pageTextSuccesses}
- all-page access failures: ${summary.accessFailures}
- usable RandomPage-style passage candidates emitted: ${summary.usablePassageCandidates}

| topic | seeds | metadata successes | volumes tested | full-view/public-likely | OCR/page successes | usable passages |
|---|---:|---:|---:|---:|---:|---:|
${topicRows}

## Source scoring

| dimension | score | note |
|---|---:|---|
| coverage | ${summary.metadataSuccesses >= 10 ? '7/10' : '5/10'} | Bibliographic lookup found records/items for ${summary.metadataSuccesses}/${summary.seedsTested} aligned seed works. |
| content depth | ${summary.pageTextSuccesses >= 5 ? '7/10' : '3/10'} | Page-level OCR can be deep when obtainable, but this run produced ${summary.pageTextSuccesses} successful OCR/page volume probes. |
| fetch stability | ${summary.pageTextSuccesses >= 5 ? '6/10' : '3/10'} | Metadata API was stable; page OCR access had ${summary.accessFailures} all-page failures among tested volumes. |
| rate limits/access requirements | ${summary.accessFailures > 0 ? '3/10' : '6/10'} | Low-volume serial requests were used; failures indicate access/browser-gating/auth constraints may dominate. |
| cleaning complexity | 6/10 | OCR requires the same boilerplate/reference/non-terminal filters RandomPage already uses. |
| passage yield | ${summary.usablePassageCandidates >= 5 ? '6/10' : '2/10'} | ${summary.usablePassageCandidates} usable ~300-word candidates in this bounded run. |
| recommendation value | 7/10 | If OCR were obtainable, HathiTrust breadth would align well with philosophy/psychology/history/literature/classics discovery. |

## Candidate volumes

| topic | intended seed | actual HathiTrust title | htid | rights | access flag | page probes ok | text chars | passage? |
|---|---|---|---|---|---|---:|---:|---|
${volumeRows || '| — | — | — | — | — | — | 0/0 | 0 | no |'}

## Candidate passage samples

| topic | title | htid | chars |
|---|---|---|---:|
${sampleRows}

Full metadata, per-page attempts, and candidate excerpts are in \`${path.relative(APP_ROOT, sampleJsonPath)}\`.

## Access failures sampled

${failureRows}

## Recommendation

${summary.usablePassageCandidates >= 5
  ? 'Create a small reviewed HathiTrust candidate queue that stores metadata/htid/access flags first, then fetches OCR only for explicitly reviewed full-view/public-likely volumes before applying existing RandomPage content filters. Keep production import separate and reviewed.'
  : 'Do not prioritize HathiTrust as a direct RandomPage passage source until unauthenticated OCR/page text access is proven reliable from the deployment/developer environment. Treat it as metadata/access discovery only and keep near-term corpus-growth effort on the existing Gutendex / Open Library → IA OCR reviewed paths.'}
`;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const seedResults = [];
  for (const seed of seeds) {
    try {
      const result = await lookupSeed(seed);
      seedResults.push({ ...result, metadataSuccess: true });
    } catch (err) {
      seedResults.push({ ...seed, metadataSuccess: false, error: err.message, items: [] });
    }
    await sleep(350);
  }

  const volumeCandidates = [];
  const seen = new Set();
  // Fill the requested 10–20 volume sample when HathiTrust returns many copies
  // for a work (common for Shakespeare/Homer). Keep at most four copies per
  // seed so one prolific record cannot dominate the whole evaluation.
  for (const seedResult of seedResults.filter((row) => row.metadataSuccess)) {
    const preferredItems = (seedResult.items || []).slice(0, 4);
    for (const item of preferredItems) {
      if (!item?.htid || seen.has(item.htid)) continue;
      seen.add(item.htid);
      volumeCandidates.push({
        topic: seedResult.topic,
        seedLabel: seedResult.label,
        title: seedResult.title,
        author: seedResult.author,
        recordId: seedResult.recordId,
        recordUrl: seedResult.recordUrl,
        htid: item.htid,
        itemUrl: item.itemURL,
        access: itemAccess(item),
      });
      if (volumeCandidates.length >= maxVolumes) break;
    }
    if (volumeCandidates.length >= maxVolumes) break;
  }

  const volumeResults = [];
  const candidates = [];
  for (const volume of volumeCandidates) {
    const probe = await probeVolume(volume);
    const result = { ...volume, ...probe };
    volumeResults.push(result);
    if (probe.passage) {
      candidates.push({
        topic: volume.topic,
        title: volume.title,
        author: volume.author,
        htid: volume.htid,
        itemUrl: volume.itemUrl,
        passage: probe.passage,
        tags: [volume.topic, 'hathitrust-page-access-eval', 'ocr-candidate'],
      });
    }
    await sleep(500);
  }

  const summary = scoreSummary(seedResults, volumeResults, candidates);
  const payload = {
    generatedAt,
    policy: 'local evaluation only; no production writes; no protected full-text import; bounded serial metadata/page OCR probes',
    pageProbes,
    summary,
    seeds: seedResults.map((row) => ({
      topic: row.topic,
      label: row.label,
      idType: row.idType,
      id: row.id,
      metadataSuccess: row.metadataSuccess,
      error: row.error,
      recordId: row.recordId,
      recordUrl: row.recordUrl,
      title: row.title,
      author: row.author,
      publishDates: row.publishDates,
      itemCount: row.itemCount || 0,
      sampledItems: (row.items || []).slice(0, 6).map((item) => ({ htid: item.htid, itemURL: item.itemURL, ...itemAccess(item) })),
    })),
    volumes: volumeResults.map((row) => ({
      topic: row.topic,
      title: row.title,
      author: row.author,
      seedLabel: row.seedLabel,
      recordId: row.recordId,
      htid: row.htid,
      itemUrl: row.itemUrl,
      access: row.access,
      pageTextChars: row.pageTextChars,
      pageAttempts: row.pageAttempts.map((attempt) => ({ ...attempt, sample: attempt.sample ? attempt.sample.slice(0, 180) : undefined })),
      passageCandidate: row.passage ? row.passage.slice(0, 700) : null,
    })),
    candidates,
  };

  await mkdir(path.dirname(sampleJsonPath), { recursive: true });
  await writeFile(sampleJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(reportPath, markdownReport({ generatedAt, seedResults, volumeResults, candidates, summary }));
  console.log(JSON.stringify({ reportPath, sampleJsonPath, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
