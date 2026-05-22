#!/usr/bin/env node

if (!process.versions?.node || Number.parseInt(process.versions.node.split('.')[0], 10) < 18) {
  console.error('error: Node 18+ required (native fetch unavailable)');
  process.exit(1);
}

const OPEN_LIBRARY_SEARCH = 'https://openlibrary.org/search.json';
const USER_AGENT = 'RandomPage/1.0 (+https://randompage.rollersoft.com.au)';
const LANGUAGE_MAP = {
  en: 'eng',
  zh: 'chi',
  ja: 'jpn',
  fr: 'fre',
  de: 'ger',
  es: 'spa',
  ru: 'rus',
};

const args = parseArgs(process.argv.slice(2));
const limit = clamp(Number(args.limit || 20), 1, 200);
const langs = parseLangs(args.lang || 'en');
const minReads = clampMin(Number(args['min-reads'] || 0), 0);
const excludeFormats = parseCsv(args['exclude-formats']);

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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampMin(value, min) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.floor(value));
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLangs(value) {
  const list = parseCsv(value).map((item) => item.toLowerCase());
  return list.length ? Array.from(new Set(list)) : ['en'];
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fetchJson(url) {
  return fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  });
}

function classifyOpenLibrary(doc) {
  const ebookAccess = doc.ebook_access || 'unknown';
  if (doc.public_scan_b || ebookAccess === 'public') return 'public-domain-full-text';
  if (ebookAccess === 'borrowable' || ebookAccess === 'printdisabled') return 'preview-link';
  return 'metadata-only';
}

function mapDoc(doc, language) {
  return {
    openlib_id: doc.key,
    title: doc.title || 'Untitled',
    authors: Array.isArray(doc.author_name) ? doc.author_name : [],
    language,
    first_publish_year: doc.first_publish_year || null,
    readinglog_count: Number(doc.readinglog_count || 0),
    want_to_read_count: Number(doc.want_to_read_count || 0),
    already_read_count: Number(doc.already_read_count || 0),
    ebook_access: doc.ebook_access || classifyOpenLibrary(doc),
    isbn: Array.isArray(doc.isbn) ? doc.isbn.slice(0, 5) : [],
    cover_edition_key: doc.cover_edition_key || null,
    source_url: doc.key ? `https://openlibrary.org${doc.key}` : 'https://openlibrary.org',
  };
}

async function fetchLang(lang) {
  const marc = LANGUAGE_MAP[lang] || lang;
  const url = new URL(OPEN_LIBRARY_SEARCH);
  url.searchParams.set('q', 'love');
  url.searchParams.set('sort', 'readinglog');
  url.searchParams.set('language', marc);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('fields', 'key,title,author_name,language,readinglog_count,want_to_read_count,already_read_count,ebook_access,isbn,first_publish_year,cover_edition_key');
  const data = await fetchJson(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs
    .filter((doc) => Number(doc.readinglog_count || 0) >= minReads)
    .map((doc) => mapDoc(doc, marc));
}

function mergeResults(rows) {
  const seen = new Map();
  for (const row of rows) {
    const existing = seen.get(row.openlib_id);
    if (!existing || row.readinglog_count > existing.readinglog_count) {
      seen.set(row.openlib_id, row);
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.readinglog_count - a.readinglog_count)
    .slice(0, limit)
    .map((row) => ({ ...row, exclude_formats: excludeFormats }));
}

async function main() {
  const batches = await Promise.all(langs.map(async (lang) => {
    try {
      return await fetchLang(lang);
    } catch (error) {
      console.error(`warn: lang=${lang} fetched 0 (${error.message})`);
      return [];
    }
  }));

  const merged = mergeResults(batches.flat());
  if (!merged.length) {
    console.error('error: no results');
    process.exit(1);
  }

  console.log(JSON.stringify(merged, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
