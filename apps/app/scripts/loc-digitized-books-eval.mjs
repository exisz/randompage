#!/usr/bin/env node

/**
 * Library of Congress Selected Digitized Books evaluation — PLANET-3874.
 *
 * Local evaluation only: no Turso writes, no production import, no summaries.
 * It reads the LOC Labs Selected Digitized Books manifest, samples direct .txt
 * OCR files, slices them into RandomPage-style passage candidates, and writes
 * local review artifacts for deciding whether a real ingest pipeline is worth
 * building.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const DATA_BASE_URL = 'https://data.labs.loc.gov/digitized-books/';
const MANIFEST_URL = `${DATA_BASE_URL}manifest.txt`;
const USER_AGENT = 'RandomPage/1.0 LOC digitized-books eval (local PLANET-3874; contact gotexis+claw@gmail.com)';
const MIN_CHARS = 180;
const MAX_CHARS = 800;
const SAMPLE_LIMIT = 8;

const args = parseArgs(process.argv.slice(2));
const maxManifestRows = clamp(Number(args.maxManifestRows || args['max-manifest-rows'] || 500), 20, 5000);
const maxTexts = clamp(Number(args.maxTexts || args['max-texts'] || 6), 1, 20);
const stride = clamp(Number(args.stride || 37), 1, 997);
const reportPath = path.resolve(APP_ROOT, args.report || 'docs/loc-digitized-books-eval-report.md');
const sampleJsonPath = path.resolve(APP_ROOT, args.samples || 'docs/loc-digitized-books-eval-samples.json');

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

async function fetchText(url, { accept = 'text/plain,*/*', retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept, 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    if (response.ok) return response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` — ${normalizeInline(body).slice(0, 140)}` : ''}`);
  }
  throw new Error('unreachable retry state');
}

function parseManifestRows(manifestText) {
  const rows = [];
  for (const rawLine of manifestText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const [filename, itemId, md5, sizeRaw, objectKey] = line.split('\t');
    if (!filename || !filename.endsWith('.txt')) continue;
    const size = Number(sizeRaw);
    const url = objectKey?.startsWith('http') ? objectKey : `https://${objectKey}`;
    rows.push({ filename, itemId, md5, size, objectKey, url });
    if (rows.length >= maxManifestRows) break;
  }
  return rows;
}

function chooseSampleRows(rows) {
  if (rows.length <= maxTexts) return rows;
  const selected = [];
  const used = new Set();
  let cursor = Math.max(0, Math.floor(rows.length / (maxTexts + 1)));
  while (selected.length < maxTexts && used.size < rows.length) {
    const index = cursor % rows.length;
    if (!used.has(index)) {
      selected.push(rows[index]);
      used.add(index);
    }
    cursor += stride;
  }
  return selected;
}

function looksLikeHeaderOrBoilerplate(text) {
  return /^(library of congress|digitized by|http:\/\/www\.archive\.org|copyright|all rights reserved|contents|index|list of illustrations|title page|preface|foreword|appendix|footnotes?|notes?|bibliography)$/i.test(text)
    || /^(chapter|book|part)\s+[ivxlcdm\d]+\.?$/i.test(text)
    || /^(page|vol\.?|no\.?|copy)\s*\d*$/i.test(text)
    || /library of congress|digitized by the internet archive|funding from the library of congress|this book is a preservation facsimile/i.test(text);
}

function sentenceTerminal(text) {
  return /[.!?。！？]['”’)]*$/.test(text);
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
    if (block.length >= MIN_CHARS && block.length <= MAX_CHARS && sentenceTerminal(block)) {
      candidates.push(block);
      continue;
    }
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

async function fetchLocItemMetadata(itemId) {
  const url = `${itemId.replace(/\/$/, '')}/?fo=json`;
  try {
    const json = JSON.parse(await fetchText(url, { accept: 'application/json', retries: 1 }));
    const item = json.item || {};
    return {
      metadataUrl: url,
      title: item.title || item.title_with_collections?.[0] || null,
      author: Array.isArray(item.contributor_names) ? item.contributor_names[0] : null,
      date: item.date || null,
      subjects: Array.isArray(item.subjects) ? item.subjects.slice(0, 8) : [],
      language: Array.isArray(item.language) ? item.language.join(', ') : item.language || null,
      locResource: Array.isArray(item.resources) ? item.resources?.[0]?.url : null,
    };
  } catch (err) {
    return { metadataUrl: url, metadataError: err.message, title: null, author: null, subjects: [] };
  }
}

async function evaluateRow(row) {
  const started = Date.now();
  try {
    const [metadata, text] = await Promise.all([
      fetchLocItemMetadata(row.itemId),
      fetchText(row.url, { accept: 'text/plain,*/*', retries: 1 }),
    ]);
    const candidates = candidatePassages(text);
    return {
      ...row,
      success: true,
      elapsedMs: Date.now() - started,
      textChars: text.length,
      metadata,
      candidateCount: candidates.length,
      estimatedCandidateDensityPerMb: row.size ? Math.round((candidates.length / (row.size / 1024 / 1024)) * 10) / 10 : null,
      samples: candidates.slice(0, 2),
    };
  } catch (err) {
    return { ...row, success: false, elapsedMs: Date.now() - started, error: err.message, candidateCount: 0, samples: [] };
  }
}

function summarize(manifestRows, sampleRows, results) {
  const successes = results.filter((row) => row.success);
  const candidateCounts = successes.map((row) => row.candidateCount);
  const textSuccesses = successes.filter((row) => row.textChars > 0).length;
  const totalCandidates = candidateCounts.reduce((sum, count) => sum + count, 0);
  const avgCandidatesPerText = successes.length ? Math.round((totalCandidates / successes.length) * 10) / 10 : 0;
  const sampledBytes = sampleRows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const manifestTxtRowsInWindow = manifestRows.length;
  const verdict = textSuccesses >= Math.min(3, sampleRows.length) && avgCandidatesPerText >= 20
    ? 'A: promising as a direct reviewed passage source; build a gated ingest follow-up'
    : textSuccesses > 0 && avgCandidatesPerText >= 5
      ? 'B: usable but needs cleanup/yield tuning before production ingest'
      : 'C: not ready; low OCR fetch or passage yield in sampled rows';
  return {
    manifestUrl: MANIFEST_URL,
    fetchMode: 'bulk manifest.txt discovery + per-file direct .txt download from LOC Labs data package',
    noProductionWrites: true,
    manifestTxtRowsInWindow,
    sampledTextFiles: sampleRows.length,
    textFetchSuccesses: textSuccesses,
    totalCandidates,
    avgCandidatesPerText,
    sampledBytes,
    estimatedPackageTextFilesFromTicket: 84058,
    estimatedPackageBooksFromTicket: 90414,
    roughPackageCandidateEstimate: avgCandidatesPerText ? Math.round(avgCandidatesPerText * 84058) : 0,
    failureModes: results.filter((row) => !row.success).map((row) => `${row.filename}: ${row.error}`),
    verdict,
  };
}

function renderReport(summary, results) {
  const lines = [];
  lines.push('# Library of Congress Selected Digitized Books eval — PLANET-3874');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Boundary');
  lines.push('');
  lines.push('- Local evaluation only; no Turso writes, no production ingest, no LLM tagging, no summaries.');
  lines.push('- Candidate snippets are existing OCR book text and are emitted only as local review artifacts.');
  lines.push('- Product boundary remains RandomPage book passages + user-owned delivery/history, not a full reader or social/book-review app.');
  lines.push('');
  lines.push('## Source access notes');
  lines.push('');
  lines.push(`- Manifest: ${summary.manifestUrl}`);
  lines.push(`- Fetch mode: ${summary.fetchMode}.`);
  lines.push('- This validates the dataset as bulk-package discovery plus per-file text fetch, not a loc.gov search crawl.');
  lines.push('- A real pipeline should keep this as reviewed/import-gated and should reuse existing passage length/content policy checks before Turso writes.');
  lines.push('');
  lines.push('## Scorecard');
  lines.push('');
  lines.push(`- Manifest .txt rows inspected: ${summary.manifestTxtRowsInWindow}`);
  lines.push(`- Sampled text files: ${summary.sampledTextFiles}`);
  lines.push(`- Text fetch successes: ${summary.textFetchSuccesses}/${summary.sampledTextFiles}`);
  lines.push(`- Sampled download size: ${Math.round(summary.sampledBytes / 1024)} KiB`);
  lines.push(`- Candidate snippets found: ${summary.totalCandidates}`);
  lines.push(`- Avg candidate snippets / successful text file: ${summary.avgCandidatesPerText}`);
  lines.push(`- Rough package-wide candidate estimate: ~${summary.roughPackageCandidateEstimate.toLocaleString()} snippets (simple avg × 84,058 text files; rough only).`);
  lines.push(`- Verdict: ${summary.verdict}`);
  lines.push('');
  lines.push('## Sampled items');
  lines.push('');
  lines.push('| File | LOC item | Title | Author | Size | Candidates | Status |');
  lines.push('|---|---|---|---:|---:|---:|---|');
  for (const row of results) {
    const title = row.metadata?.title ? row.metadata.title.replace(/\|/g, '/') : 'unknown';
    const author = row.metadata?.author ? row.metadata.author.replace(/\|/g, '/') : '';
    const status = row.success ? 'ok' : `failed: ${row.error}`;
    lines.push(`| ${row.filename} | ${row.itemId} | ${title} | ${author} | ${Math.round((row.size || 0) / 1024)} KiB | ${row.candidateCount} | ${status.replace(/\|/g, '/')} |`);
  }
  if (summary.failureModes.length) {
    lines.push('');
    lines.push('## Failure modes');
    lines.push('');
    for (const failure of summary.failureModes) lines.push(`- ${failure}`);
  }
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  if (summary.verdict.startsWith('A')) {
    lines.push('Create a follow-up gated ingest ticket: read manifest rows into a reviewed queue, fetch selected `.txt` files serially, run existing readability/length/content filters, write dry-run reports by default, and require explicit `--apply --ack-reviewed` before production inserts.');
  } else if (summary.verdict.startsWith('B')) {
    lines.push('Create a cleanup/yield follow-up before ingest: sample more rows by topic/date, tune OCR boilerplate/page-header cleanup, then decide whether to build the gated ingest path.');
  } else {
    lines.push('Do not build ingestion yet. First investigate access/fetch failures and whether LOC Text Services or a different package slice yields cleaner book text.');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  console.log(`[loc-eval] fetching manifest ${MANIFEST_URL}`);
  const manifestText = await fetchText(MANIFEST_URL, { accept: 'text/plain,*/*', retries: 1 });
  const manifestRows = parseManifestRows(manifestText);
  const sampleRows = chooseSampleRows(manifestRows);
  console.log(`[loc-eval] sampled ${sampleRows.length} text files from ${manifestRows.length} inspected manifest rows`);

  const results = [];
  for (const row of sampleRows) {
    console.log(`[loc-eval] fetching ${row.filename} (${Math.round((row.size || 0) / 1024)} KiB)`);
    results.push(await evaluateRow(row));
    await sleep(350);
  }

  const summary = summarize(manifestRows, sampleRows, results);
  const samples = results.flatMap((row) => row.samples.map((text, index) => ({
    filename: row.filename,
    itemId: row.itemId,
    textUrl: row.url,
    title: row.metadata?.title || null,
    author: row.metadata?.author || null,
    sampleIndex: index + 1,
    chars: text.length,
    text,
  }))).slice(0, SAMPLE_LIMIT);

  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(sampleJsonPath), { recursive: true });
  await writeFile(reportPath, renderReport(summary, results));
  await writeFile(sampleJsonPath, `${JSON.stringify({ summary, results, samples }, null, 2)}\n`);

  console.log(`[loc-eval] wrote ${path.relative(APP_ROOT, reportPath)}`);
  console.log(`[loc-eval] wrote ${path.relative(APP_ROOT, sampleJsonPath)}`);
  console.log(`[loc-eval] verdict: ${summary.verdict}`);
}

main().catch((err) => {
  console.error(`[loc-eval] failed: ${err.stack || err.message}`);
  process.exit(1);
});
