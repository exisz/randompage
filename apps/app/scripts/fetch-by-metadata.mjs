#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const sleepMs = clampMin(Number(args['sleep-ms'] ?? 2000), 0);
const searchTimeout = clampMin(Number(args['search-timeout'] ?? 30), 1);
const fetchTimeout = clampMin(Number(args['fetch-timeout'] ?? 120), 1);
const inputPath = args.input ? String(args.input) : null;
const limit = args.limit == null ? null : clampMin(Number(args.limit), 0);

const stats = {
  total: 0,
  ok: 0,
  not_found: 0,
  timeout: 0,
  fetch_failed: 0,
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function clampMin(value, min) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.floor(value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readInput() {
  const text = inputPath ? await readFile(inputPath, 'utf8') : await readStdin();
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('input must be a JSON array');
  }
  return limit == null ? parsed : parsed.slice(0, limit);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(data));
  });
}

function firstArrayValue(value) {
  if (Array.isArray(value)) return value.find((item) => item != null && String(item).trim()) || '';
  return value == null ? '' : String(value);
}

function normalizeIsbn(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const variants = new Set([digits]);
  if (digits.length === 13 && /^(978|979)/.test(digits)) variants.add(digits.slice(3));
  if (digits.length === 10) variants.add(`978${digits}`);
  return { query: digits, variants: Array.from(variants).filter(Boolean) };
}

function buildQuery(book) {
  const isbn = normalizeIsbn(firstArrayValue(book?.isbn));
  if (isbn?.query) return { query: isbn.query, isbnVariants: isbn.variants };

  const title = String(book?.title || '').trim();
  const author = firstArrayValue(book?.authors).trim();
  return { query: [title, author].filter(Boolean).join(' ').trim(), isbnVariants: [] };
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeAuthors(value) {
  const values = Array.isArray(value) ? value : [value];
  return new Set(values
    .flatMap((item) => normalizeTitle(item).split(' '))
    .filter((token) => token.length > 1));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

function runCommand(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

function candidateBrief(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id ?? null,
    title: candidate.title ?? null,
    format: candidate.format ?? null,
    size: candidate.size ?? null,
  };
}

function candidateSeenBrief(candidate) {
  return candidateBrief(candidate);
}

function scoreCandidate(book, candidate, isbnVariants) {
  let score = 0;
  const haystack = `${candidate?.title || ''} ${Array.isArray(candidate?.authors) ? candidate.authors.join(' ') : candidate?.authors || ''}`;
  const numericHaystack = haystack.replace(/[^0-9]/g, '');
  if (isbnVariants.some((isbn) => isbn && numericHaystack.includes(isbn))) score += 10;

  const expectedTitle = normalizeTitle(book?.title);
  const candidateTitle = normalizeTitle(candidate?.title);
  if (expectedTitle && candidateTitle) {
    const distance = levenshtein(expectedTitle, candidateTitle);
    if (distance <= 5) score += 5 - distance;
  }

  const expectedAuthors = tokenizeAuthors(book?.authors || []);
  const candidateAuthors = tokenizeAuthors(candidate?.authors || []);
  if ([...expectedAuthors].some((token) => candidateAuthors.has(token))) score += 3;

  return score;
}

function pickBestCandidate(book, candidates, isbnVariants) {
  const epubCandidates = candidates.filter((candidate) => String(candidate?.format || '').toLowerCase() === 'epub');
  if (!epubCandidates.length) return null;

  let best = epubCandidates[0];
  let bestScore = scoreCandidate(book, best, isbnVariants);
  for (const candidate of epubCandidates.slice(1)) {
    const score = scoreCandidate(book, candidate, isbnVariants);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { candidate: bestScore === 0 ? epubCandidates[0] : best, score: bestScore };
}

function recordBase(book, query) {
  return {
    openlib_id: book?.openlib_id ?? null,
    title: book?.title ?? null,
    query,
  };
}

function writeRecord(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function countStatus(status) {
  if (status === 'ok') stats.ok += 1;
  else if (status === 'timeout') stats.timeout += 1;
  else if (status === 'fetch_failed') stats.fetch_failed += 1;
  else if (status === 'not_found_epub') stats.not_found += 1;
}

async function processBook(book) {
  const { query, isbnVariants } = buildQuery(book);
  const base = recordBase(book, query);

  if (!query) {
    return { ...base, status: 'error', error: 'empty query' };
  }

  const search = await runCommand('bookworm', ['search', query, '--max-results', '10', '--no-raw', '--timeout', String(searchTimeout)]);
  const searchJson = parseJsonSafe(search.stdout);
  const candidates = Array.isArray(searchJson?.books) ? searchJson.books : [];

  if (search.code !== 0 || !searchJson) {
    return {
      ...base,
      status: 'error',
      error: searchJson?.error || search.stderr.slice(0, 300) || `bookworm search exited ${search.code}`,
    };
  }

  const best = pickBestCandidate(book, candidates, isbnVariants);
  if (!best) {
    return {
      ...base,
      status: 'not_found_epub',
      candidates: candidates.map(candidateSeenBrief).filter(Boolean),
    };
  }

  const candidate = best.candidate;
  if (dryRun) {
    return {
      ...base,
      candidate: candidateBrief(candidate),
      status: 'candidate_found',
    };
  }

  const fetched = await runCommand('bookworm', ['fetch', String(candidate.id), '--timeout', String(fetchTimeout)]);
  const fetchedJson = parseJsonSafe(fetched.stdout);
  if (fetched.code === 0 && fetchedJson) {
    return {
      ...base,
      bookworm_book_id: fetchedJson.book_id ?? candidate.id,
      local_path: fetchedJson.path ?? null,
      bytes: fetchedJson.bytes ?? null,
      sha256: fetchedJson.sha256 ?? null,
      format: fetchedJson.format ?? candidate.format ?? null,
      elapsed_seconds: fetchedJson.elapsed_seconds ?? null,
      status: 'ok',
    };
  }

  if (fetched.code === 3) {
    return {
      ...base,
      bookworm_book_id: candidate.id,
      status: 'timeout',
      waited_seconds: fetchedJson?.waited_seconds ?? fetchedJson?.timeout ?? fetchTimeout,
    };
  }

  return {
    ...base,
    bookworm_book_id: candidate.id,
    status: 'fetch_failed',
    stderr: (fetched.stderr || fetchedJson?.error || `bookworm fetch exited ${fetched.code}`).slice(0, 300),
  };
}

async function main() {
  let books;
  try {
    books = await readInput();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  stats.total = books.length;
  for (let i = 0; i < books.length; i += 1) {
    let record;
    try {
      record = await processBook(books[i]);
    } catch (error) {
      const { query } = buildQuery(books[i]);
      record = {
        ...recordBase(books[i], query),
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    countStatus(record.status);
    writeRecord(record);

    if (i < books.length - 1 && sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  console.error(`summary: total=${stats.total} ok=${stats.ok} not_found=${stats.not_found} timeout=${stats.timeout} fetch_failed=${stats.fetch_failed}`);
}

main();
