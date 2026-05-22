#!/usr/bin/env node

const OPEN_LIBRARY_SEARCH = 'https://openlibrary.org/search.json';
const GOOGLE_BOOKS_SEARCH = 'https://www.googleapis.com/books/v1/volumes';

const args = parseArgs(process.argv.slice(2));
const query = args.query || args.q || 'classic literature philosophy history';
const limit = clamp(Number(args.limit || 20), 1, 40);
const source = String(args.source || 'all');

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

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function stableKey(title, author) {
  return `${title || ''}::${author || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function classifyOpenLibrary(doc) {
  const ebookAccess = doc.ebook_access || 'unknown';
  if (doc.public_scan_b || ebookAccess === 'public') return 'public-domain-full-text';
  if (ebookAccess === 'borrowable' || ebookAccess === 'printdisabled') return 'preview-link';
  return 'metadata-only';
}

function classifyGoogleBooks(accessInfo = {}, searchInfo = {}) {
  if (accessInfo.publicDomain && accessInfo.viewability === 'ALL_PAGES') return 'public-domain-full-text';
  if (accessInfo.viewability && accessInfo.viewability !== 'NO_PAGES') return 'preview-link';
  if (searchInfo.textSnippet) return 'snippet-only';
  return 'metadata-only';
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'RandomPage/1.0 (+https://randompage.rollersoft.com.au)',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function searchOpenLibrary() {
  const url = new URL(OPEN_LIBRARY_SEARCH);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(Math.max(limit, 20)));
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,language,ebook_access,public_scan_b,ia,cover_edition_key');
  const data = await fetchJson(url);
  return (data.docs || []).map((doc) => {
    const author = first(doc.author_name) || 'Unknown';
    const sourceUrl = doc.key ? `https://openlibrary.org${doc.key}` : 'https://openlibrary.org/search';
    const accessDepth = classifyOpenLibrary(doc);
    return {
      source: 'openlibrary',
      source_id: doc.key,
      title: doc.title || 'Untitled',
      author,
      source_url: sourceUrl,
      access_depth: accessDepth,
      public_domain_candidate: accessDepth === 'public-domain-full-text',
      allowed_full_text_fetch: accessDepth === 'public-domain-full-text',
      first_publish_year: doc.first_publish_year || null,
      language: first(doc.language) || null,
      rights_note: accessDepth === 'public-domain-full-text'
        ? 'Open Library reports public scan/public ebook access; verify item page before passage generation.'
        : 'Metadata/linkout only; do not cache protected text.',
    };
  });
}

async function searchGoogleBooks() {
  const url = new URL(GOOGLE_BOOKS_SEARCH);
  url.searchParams.set('q', query);
  url.searchParams.set('printType', 'books');
  url.searchParams.set('maxResults', String(Math.min(limit, 40)));
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (apiKey) url.searchParams.set('key', apiKey);
  const data = await fetchJson(url, apiKey ? {} : {});
  return (data.items || []).map((item) => {
    const volume = item.volumeInfo || {};
    const accessInfo = item.accessInfo || {};
    const accessDepth = classifyGoogleBooks(accessInfo, item.searchInfo || {});
    return {
      source: 'googlebooks',
      source_id: item.id,
      title: volume.title || 'Untitled',
      author: first(volume.authors) || 'Unknown',
      source_url: volume.infoLink || volume.previewLink || accessInfo.webReaderLink || item.selfLink,
      access_depth: accessDepth,
      public_domain_candidate: Boolean(accessInfo.publicDomain),
      allowed_full_text_fetch: accessDepth === 'public-domain-full-text',
      first_publish_year: volume.publishedDate ? Number.parseInt(volume.publishedDate.slice(0, 4), 10) || null : null,
      language: volume.language || null,
      snippet_available: Boolean(item.searchInfo?.textSnippet),
      rights_note: accessDepth === 'public-domain-full-text'
        ? 'Google Books reports publicDomain + ALL_PAGES; verify source before passage generation.'
        : 'Metadata/linkout only; protected preview/snippet text must not be cached.',
    };
  });
}

async function main() {
  const batches = [];
  const errors = [];

  if (source === 'all' || source === 'openlibrary') {
    try { batches.push(await searchOpenLibrary()); } catch (err) { errors.push(`openlibrary: ${err.message}`); }
  }
  if (source === 'all' || source === 'googlebooks') {
    try { batches.push(await searchGoogleBooks()); } catch (err) { errors.push(`googlebooks: ${err.message}`); }
  }

  const seen = new Set();
  const candidates = [];
  for (const row of batches.flat()) {
    const key = stableKey(row.title, row.author);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(row);
    if (candidates.length >= limit) break;
  }

  const result = {
    query,
    requested_limit: limit,
    returned: candidates.length,
    policy: 'metadata-first; no protected text cached; generate passages only for verified public-domain/licensed full text',
    candidates,
    errors,
  };

  console.log(JSON.stringify(result, null, 2));
  if (candidates.length < limit) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
