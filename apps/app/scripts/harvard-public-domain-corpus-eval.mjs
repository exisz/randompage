#!/usr/bin/env node

/**
 * Harvard / Institutional Books 1.0 passage-source evaluation — PLANET-3911.
 *
 * Local evaluation only: no Turso writes, no production import, no summaries.
 * The public metadata dataset is sampled through Hugging Face Dataset Server.
 * Full OCR rows are early-access/gated; when an HF token with accepted access is
 * present, this script attempts a tiny serial text sample. Without that access it
 * still writes a metadata/provenance report and explicitly recommends against a
 * reviewed ingest until text access is approved and direct enough.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const METADATA_DATASET = 'institutional/institutional-books-1.0-metadata';
const FULL_TEXT_DATASET = 'institutional/institutional-books-1.0';
const METADATA_ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const DATASET_INFO_URL = 'https://huggingface.co/api/datasets/institutional/institutional-books-1.0/tree/main/data?recursive=false';
const DATASET_CARD_URL = 'https://huggingface.co/datasets/institutional/institutional-books-1.0';
const METADATA_CARD_URL = 'https://huggingface.co/datasets/institutional/institutional-books-1.0-metadata';
const HARVARD_CORPUS_URL = 'https://library.harvard.edu/services-tools/harvard-library-public-domain-corpus';
const USER_AGENT = 'RandomPage/1.0 Harvard public-domain-corpus eval (local PLANET-3911; contact gotexis+claw@gmail.com)';
const MIN_CHARS = 180;
const MAX_CHARS = 800;

const args = parseArgs(process.argv.slice(2));
const offset = clamp(Number(args.offset || 0), 0, 900000);
const metadataRows = clamp(Number(args.metadataRows || args['metadata-rows'] || 15), 1, 100);
const maxTexts = clamp(Number(args.maxTexts || args['max-texts'] || 3), 0, 8);
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/harvard-public-domain-corpus-eval-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/harvard-public-domain-corpus-eval-samples.json');
const hfToken = args.hfToken || args['hf-token'] || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '';

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

function normalize(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeInline(text) {
  return normalize(text).replace(/\s+/g, ' ').trim();
}

async function fetchText(url, { accept = '*/*', retries = 1, token = '' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const headers = { accept, 'user-agent': USER_AGENT };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, redirect: 'follow' });
    if (response.ok) return response.text();
    const body = await response.text().catch(() => '');
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${normalizeInline(body).slice(0, 180)}` : ''}`);
  }
  throw new Error('unreachable retry state');
}

async function fetchRows(dataset, { rowOffset, length, token = '' }) {
  const url = new URL(METADATA_ROWS_URL);
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('config', 'default');
  url.searchParams.set('split', 'train');
  url.searchParams.set('offset', String(rowOffset));
  url.searchParams.set('length', String(length));
  const json = JSON.parse(await fetchText(url.toString(), { accept: 'application/json', retries: 1, token }));
  return (json.rows || []).map((entry) => entry.row || entry);
}

function compactValue(value, max = 220) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => compactValue(v, Math.floor(max / Math.max(value.length, 1)))).filter(Boolean);
  if (typeof value === 'object') return value;
  return normalizeInline(value).slice(0, max);
}

function metadataSummary(row) {
  return {
    barcode: row.barcode_src,
    title: compactValue(row.title_src),
    author: compactValue(row.author_src),
    date: compactValue(row.date1_src || row.date2_src),
    languageSrc: row.language_src,
    languageGen: row.language_gen,
    pageCount: row.page_count_src,
    tokenCount: row.token_count_o200k_base_gen,
    topic: compactValue(row.topic_or_subject_gen || row.topic_or_subject_src),
    genre: compactValue(row.genre_or_form_src),
    ocrScoreSrc: row.ocr_score_src,
    ocrScoreGen: row.ocr_score_gen,
    hathitrustUrl: row.hathitrust_data_ext?.url || null,
    rightsCode: row.hathitrust_data_ext?.rights_code || null,
  };
}

function isLikelyEnglishBook(row) {
  const lang = String(row.language_gen || row.language_src || '').toLowerCase();
  const tokens = Number(row.token_count_o200k_base_gen || 0);
  const pages = Number(row.page_count_src || 0);
  return lang === 'eng' && tokens >= 20000 && tokens <= 350000 && pages >= 80;
}

function sentenceTerminal(text) {
  return /[.!?。！？]['”’)]*$/.test(text);
}

function looksLikeHeaderOrBoilerplate(text) {
  return /^(contents|index|preface|foreword|appendix|footnotes?|notes?|bibliography|chapter|book|part)\b/i.test(text)
    || /^(page|vol\.?|no\.?)\s*\d*$/i.test(text)
    || /google|digitized by|harvard college library|hathitrust|public domain|copyright|all rights reserved/i.test(text);
}

function usableBlock(block) {
  const text = normalizeInline(block);
  if (text.length < 90) return false;
  if (looksLikeHeaderOrBoilerplate(text)) return false;
  if ((text.match(/\b(chapter|contents|illustration|figure|table)\b/gi) || []).length >= 4 && text.length < 900) return false;
  const letters = (text.match(/[A-Za-z\p{L}]/gu) || []).length;
  if (letters / Math.max(text.length, 1) < 0.5) return false;
  return true;
}

function splitSentences(text) {
  return normalizeInline(text).match(/[^.!?。！？]+[.!?。！？]['”’)]*/g) || [normalizeInline(text)];
}

function candidatePassages(rawText) {
  const blocks = normalize(rawText)
    .split(/\n\s*\n|(?<=\.)\n(?=[A-Z“”])/g)
    .map(normalizeInline)
    .filter(usableBlock);
  const candidates = [];
  let buffer = '';
  function flush() {
    const text = normalizeInline(buffer);
    if (text.length >= MIN_CHARS && text.length <= MAX_CHARS && sentenceTerminal(text)) candidates.push(text);
    buffer = '';
  }
  for (const block of blocks) {
    const parts = block.length > MAX_CHARS ? splitSentences(block) : [block];
    for (const part of parts.map(normalizeInline).filter(Boolean)) {
      const next = normalizeInline(`${buffer} ${part}`);
      if (next.length > MAX_CHARS) {
        flush();
        buffer = part;
      } else {
        buffer = next;
      }
      if (buffer.length >= MIN_CHARS && sentenceTerminal(buffer)) flush();
    }
  }
  flush();
  return candidates;
}

function extractTextFromFullRow(row) {
  const pages = Array.isArray(row.text_by_page_gen) && row.text_by_page_gen.length ? row.text_by_page_gen : row.text_by_page_src;
  if (Array.isArray(pages)) return pages.map((page) => typeof page === 'string' ? page : '').join('\n\n');
  return '';
}

async function tryTextRows(startOffset, candidates) {
  if (!hfToken || maxTexts === 0) {
    return { attempted: false, reason: hfToken ? 'maxTexts=0' : 'missing HF_TOKEN/HUGGINGFACE_TOKEN for gated full-text dataset', results: [] };
  }
  const results = [];
  for (const candidate of candidates.slice(0, maxTexts)) {
    await sleep(300);
    try {
      const rows = await fetchRows(FULL_TEXT_DATASET, { rowOffset: startOffset + candidate.metadataIndex, length: 1, token: hfToken });
      const row = rows[0] || {};
      const text = extractTextFromFullRow(row);
      const passages = candidatePassages(text);
      results.push({ ...candidate, textFetchSuccess: true, textChars: text.length, candidateCount: passages.length, samples: passages.slice(0, 2) });
    } catch (err) {
      results.push({ ...candidate, textFetchSuccess: false, error: err.message, candidateCount: 0, samples: [] });
    }
  }
  return { attempted: true, reason: 'HF token present; attempted gated full-text row fetch', results };
}

async function fetchShardInfo() {
  try {
    const files = JSON.parse(await fetchText(DATASET_INFO_URL, { accept: 'application/json', retries: 1 }));
    const parquetFiles = files.filter((file) => String(file.path || '').endsWith('.parquet'));
    const totalBytes = parquetFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
    return { accessible: true, parquetFileCount: parquetFiles.length, firstShardSizeBytes: parquetFiles[0]?.size || null, listedBytes: totalBytes };
  } catch (err) {
    return { accessible: false, error: err.message };
  }
}

function verdict(textProbe) {
  const successes = textProbe.results.filter((row) => row.textFetchSuccess && row.candidateCount > 0);
  if (successes.length > 0) return 'promising_after_access_approval';
  if (textProbe.attempted) return 'blocked_text_access_or_fetch_failed';
  return 'metadata_promising_but_text_access_gated';
}

function buildReport({ metadata, filtered, shardInfo, textProbe }) {
  const successRows = textProbe.results.filter((row) => row.textFetchSuccess);
  const sampleRows = successRows.filter((row) => row.candidateCount > 0);
  const yieldAvg = sampleRows.length ? Math.round(sampleRows.reduce((sum, row) => sum + row.candidateCount, 0) / sampleRows.length) : 0;
  const decision = verdict(textProbe);
  return `# Harvard Public Domain Corpus / Institutional Books 1.0 eval — PLANET-3911\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Scope\n\n` +
    `Local evaluation only. This command writes JSON/Markdown artifacts under \`apps/app/docs\`, never connects to Turso, never writes production data, and does not create summaries or substitute content.\n\n` +
    `## Source access facts\n\n` +
    `- Harvard corpus page: ${HARVARD_CORPUS_URL}\n` +
    `- Full dataset card: ${DATASET_CARD_URL}\n` +
    `- Metadata dataset card: ${METADATA_CARD_URL}\n` +
    `- Published scale reported by source: 983,004 public-domain books, ~242B tokens, ~386M pages; full dataset is ~947 GB parquet.\n` +
    `- Metadata rows sampled: ${metadata.length} from offset ${offset}; English/book-like rows selected: ${filtered.length}.\n` +
    `- Full-text access mode: ${textProbe.attempted ? textProbe.reason : textProbe.reason}.\n` +
    `- Full-text parquet listing: ${shardInfo.accessible ? `${shardInfo.parquetFileCount} shards listed; first shard ${shardInfo.firstShardSizeBytes} bytes` : `not listed (${shardInfo.error})`}.\n\n` +
    `## Text fetch / yield result\n\n` +
    `- Text rows attempted: ${textProbe.results.length}\n` +
    `- Text fetch successes: ${successRows.length}\n` +
    `- Rows with clean RandomPage candidate snippets: ${sampleRows.length}\n` +
    `- Average candidate snippets per successful sampled book: ${yieldAvg || 'n/a'}\n` +
    `- Verdict: **${decision}**\n\n` +
    `## Recommendation\n\n` +
    (decision === 'promising_after_access_approval'
      ? `Build a gated reviewed queue only after confirming IDI early-access terms are acceptable for RandomPage use. Keep rows metadata-first, reviewed:false by default, and fetch OCR text only for human-approved barcodes.\n\n`
      : `Do not build production ingest yet. The public metadata path is stable and high-scale, but direct OCR text access is gated/too heavy for an unauthenticated local eval. Next step is to obtain accepted Hugging Face/IDI access and rerun this command with \`HF_TOKEN\`; only then decide whether a reviewed ingest queue is justified.\n\n`) +
    `## Boundary check\n\n` +
    `- Existing book passage candidates only.\n` +
    `- No summaries, LLM-derived substitute content, full-reader UI, social/feed/paywall layer, or direct unreviewed Discover/push exposure.\n` +
    `- Any follow-up ingest must be dry-run by default and require human reviewed allowlist + explicit apply acknowledgement.\n\n` +
    `## Sample metadata rows\n\n` +
    filtered.slice(0, 5).map((row, idx) => `${idx + 1}. ${row.title || '(untitled)'} — ${row.author || '(unknown)'} (${row.date || 'n.d.'}); lang=${row.languageGen || row.languageSrc}; tokens=${row.tokenCount}; ocr=${row.ocrScoreGen ?? row.ocrScoreSrc ?? 'n/a'}; hathi=${row.hathitrustUrl || 'n/a'}`).join('\n') +
    `\n\n## Sample candidate snippets\n\n` +
    (sampleRows.length
      ? sampleRows.flatMap((row) => row.samples.map((sample) => `- ${row.title || row.barcode}: ${sample.slice(0, 260)}`)).join('\n')
      : `No full-text snippets emitted in this run because OCR text access was not available. The JSON artifact still includes sampled metadata and fetch errors for follow-up.`) +
    `\n`;
}

async function main() {
  const [metadataRowsResult, shardInfo] = await Promise.all([
    fetchRows(METADATA_DATASET, { rowOffset: offset, length: metadataRows }),
    fetchShardInfo(),
  ]);
  const metadata = metadataRowsResult.map((row, index) => ({ metadataIndex: index, ...metadataSummary(row) }));
  const filtered = metadata.filter((row, index) => isLikelyEnglishBook(metadataRowsResult[index]));
  const textProbe = await tryTextRows(offset, filtered);
  const artifact = {
    generatedAt: new Date().toISOString(),
    ticket: 'PLANET-3911',
    source: {
      harvardCorpusUrl: HARVARD_CORPUS_URL,
      datasetCardUrl: DATASET_CARD_URL,
      metadataCardUrl: METADATA_CARD_URL,
      metadataDataset: METADATA_DATASET,
      fullTextDataset: FULL_TEXT_DATASET,
      reportedScale: { books: 983004, tokens: '242B', pages: '386M', fullDatasetSize: '947GB' },
    },
    options: { offset, metadataRows, maxTexts, usedToken: Boolean(hfToken) },
    shardInfo,
    metadataSamples: metadata,
    selectedEnglishBookLikeRows: filtered,
    textProbe,
    verdict: verdict(textProbe),
    boundary: {
      localOnly: true,
      tursoWrites: false,
      summaries: false,
      unreviewedDiscoverOrPushExposure: false,
    },
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(sampleJsonPath), { recursive: true });
  await writeFile(sampleJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(reportPath, buildReport({ metadata, filtered, shardInfo, textProbe }));
  console.log(`WROTE ${path.relative(APP_ROOT, reportPath)}`);
  console.log(`WROTE ${path.relative(APP_ROOT, sampleJsonPath)}`);
  console.log(`VERDICT ${artifact.verdict}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
