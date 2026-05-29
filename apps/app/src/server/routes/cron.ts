import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { getPrisma } from '../lib/prisma.js';
import type { Passage, PrismaClient } from '../generated/prisma/index.js';

export const cronRouter = Router();

type CronSummary = {
  cron: string;
  ok: boolean;
  processed?: number;
  inserted?: number;
  tagged?: number;
  failed?: number;
  skipped?: number;
  durationMs: number;
  error?: string;
};

type BookQueueItem = {
  slug: string;
  title: string;
  author: string;
  /**
   * Ordered plaintext mirrors. GitHub raw GITenberg URLs are primary because
   * production serverless fetches to gutenberg.org can be intermittently denied
   * or redirected differently from local curl.
   */
  urls: string[];
  language?: string;
};

function pgCacheUrls(id: number) {
  return [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
  ];
}

function book(slug: string, title: string, author: string, gutenbergId: number, gitUrls: string[] = [], language = 'en'): BookQueueItem {
  return {
    slug,
    title,
    author,
    urls: [...gitUrls, ...pgCacheUrls(gutenbergId)],
    language,
  };
}


const BOOK_QUEUE: BookQueueItem[] = [
  book('jane-austen-pride-and-prejudice', 'Pride and Prejudice', 'Jane Austen', 1342, [
    'https://raw.githubusercontent.com/GITenberg/Pride-and-Prejudice_1342/master/1342-0.txt',
    'https://raw.githubusercontent.com/GITenberg/Pride-and-Prejudice_1342/master/1342.txt',
  ]),
  book('mary-shelley-frankenstein', 'Frankenstein', 'Mary Shelley', 84, [
    'https://raw.githubusercontent.com/GITenberg/Frankenstein_84/master/84-0.txt',
    'https://raw.githubusercontent.com/GITenberg/Frankenstein_84/master/84.txt',
  ]),
  book('frederick-douglass-narrative', 'Narrative of the Life of Frederick Douglass', 'Frederick Douglass', 23, [
    'https://raw.githubusercontent.com/GITenberg/Narrative-of-the-Life-of-Frederick-Douglass-an-American-Slave_23/master/23.txt',
  ]),
  book('lewis-carroll-alice', "Alice's Adventures in Wonderland", 'Lewis Carroll', 11),
  book('arthur-conan-doyle-sherlock-holmes', 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 1661),
  book('herman-melville-moby-dick', 'Moby-Dick; or, The Whale', 'Herman Melville', 2701),
  book('charles-dickens-tale-of-two-cities', 'A Tale of Two Cities', 'Charles Dickens', 98),
  book('bram-stoker-dracula', 'Dracula', 'Bram Stoker', 345),
  book('franz-kafka-metamorphosis', 'Metamorphosis', 'Franz Kafka', 5200),
  book('jacob-grimm-grimms-fairy-tales', "Grimms' Fairy Tales", 'Jacob Grimm and Wilhelm Grimm', 2591),
  book('mark-twain-tom-sawyer', 'The Adventures of Tom Sawyer', 'Mark Twain', 74),
  book('mark-twain-huckleberry-finn', 'Adventures of Huckleberry Finn', 'Mark Twain', 76),
  book('charlotte-bronte-jane-eyre', 'Jane Eyre', 'Charlotte Brontë', 1260),
  book('charles-dickens-great-expectations', 'Great Expectations', 'Charles Dickens', 1400),
  book('emily-bronte-wuthering-heights', 'Wuthering Heights', 'Emily Brontë', 768),
  book('joseph-conrad-heart-of-darkness', 'Heart of Darkness', 'Joseph Conrad', 219),
  book('lucy-maud-montgomery-anne', 'Anne of Green Gables', 'L. M. Montgomery', 45),
  book('fyodor-dostoyevsky-crime-and-punishment', 'Crime and Punishment', 'Fyodor Dostoyevsky', 2554),
  book('charles-dickens-christmas-carol', 'A Christmas Carol', 'Charles Dickens', 46),
  book('louisa-may-alcott-little-women', 'Little Women', 'Louisa May Alcott', 514),
  book('robert-louis-stevenson-treasure-island', 'Treasure Island', 'Robert Louis Stevenson', 120),
  book('james-joyce-ulysses', 'Ulysses', 'James Joyce', 4300),
  book('leo-tolstoy-war-and-peace', 'War and Peace', 'Leo Tolstoy', 2600),
  book('homer-iliad', 'The Iliad', 'Homer', 6130),
  book('homer-odyssey', 'The Odyssey', 'Homer', 1727),
  book('william-shakespeare-complete-works', 'The Complete Works of William Shakespeare', 'William Shakespeare', 100),
  book('j-m-barrie-peter-pan', 'Peter Pan', 'J. M. Barrie', 16),
  book('friedrich-nietzsche-zarathustra', 'Thus Spake Zarathustra', 'Friedrich Nietzsche', 1998),
  book('jonathan-swift-modest-proposal', 'A Modest Proposal', 'Jonathan Swift', 1080),
  book('sun-tzu-art-of-war', 'The Art of War', 'Sun Tzu', 132),
];

function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.header('authorization');
  const headerSecret = req.header('x-cron-secret');
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

function numericQuery(req: Request, key: string, fallback: number, min: number, max: number) {
  const raw = req.query[key];
  const n = typeof raw === 'string' ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function truncate(value: unknown, max = 1500) {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function notifyPipeline(summary: CronSummary) {
  const webhook = process.env.RANDOMPAGE_DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;

  const lines = [
    `${summary.ok ? '✅' : '❌'} RandomPage ${summary.cron}`,
    `processed=${summary.processed ?? 0} inserted=${summary.inserted ?? 0} tagged=${summary.tagged ?? 0} failed=${summary.failed ?? 0} skipped=${summary.skipped ?? 0}`,
    `duration=${summary.durationMs}ms`,
  ];
  if (summary.error) lines.push(`error=\`${summary.error.slice(0, 1500)}\``);

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: lines.join('\n') }),
    });
  } catch (err) {
    console.log(`[cron notify] failed: ${truncate(err, 500)}`);
  }
}

function stripBoilerplate(raw: string) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/^.*?\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*{3}/is, '')
    .replace(/\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*$/i, '')
    .replace(/^.*?This ebook is the product of many hours of hard work by volunteers[\s\S]*?\n\n/i, '')
    .trim();
}

function isLikelyBoilerplate(text: string) {
  const lower = text.toLowerCase();
  return lower.includes('standard ebooks is a volunteer-driven project') ||
    lower.includes('project gutenberg') ||
    lower.includes('this ebook is the product of many hours') ||
    lower.includes('copyright pages exist to tell you') ||
    lower.includes('check for updates to this ebook');
}

function isLikelyReferenceNoteFragment(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.startsWith('↩')) return true;
  if (/^(?:note|notes|footnote|footnotes|endnote|endnotes)\s*[:.\-—]/i.test(normalized)) return true;
  if (/^(?:\[[^\]]{1,80}\]|\([^)]{1,80}\))\s*(?:note|footnote|editor|translator|transcriber)/i.test(normalized)) return true;
  if (/^(?:for\s+.{1,80},\s*)?(?:see|cf\.)\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b|^for\s+.{1,80},\s*see\s+(?:note|notes|footnote|footnotes|endnote|endnotes)\b/i.test(normalized)) return true;
  return ((normalized.slice(0, 220).match(/(?:↩|\[[0-9ivxlcdm]+\]|\([0-9ivxlcdm]+\)|\^[0-9]+|†|‡)/gi) ?? []).length >= 3);
}

const MIN_PASSAGE_CHARS = 180;
const TARGET_PASSAGE_CHARS = 300;
const MAX_PASSAGE_CHARS = 800;


function hasTerminalSentencePunctuation(text: string) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return /[.!?…。！？][\"'”’）)\]》」』]*$/.test(normalized);
}

function splitOnSentenceBoundaries(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const matches = normalized.match(/[^.!?…。！？]+[.!?…。！？][\"'”’）)\]》」』]*/g) || [];
  return matches.map((part: string) => part.trim()).filter(Boolean);
}

function isReadableTextCandidate(text: string) {
  const len = text.length;
  return len >= MIN_PASSAGE_CHARS && len <= MAX_PASSAGE_CHARS && hasTerminalSentencePunctuation(text) && !isLikelyReferenceNoteFragment(text);
}

function sentenceBoundaryChunks(text: string): string[] {
  const units = splitOnSentenceBoundaries(text).filter((unit: string) => unit.length <= MAX_PASSAGE_CHARS && !isLikelyReferenceNoteFragment(unit));
  const chunks: string[] = [];
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

function slicePassages(raw: string, maxPassages: number) {
  const clean = stripBoilerplate(raw);
  const paragraphs = clean
    .split(/\n\s*\n/g)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0 && !isLikelyBoilerplate(p) && !isLikelyReferenceNoteFragment(p));

  const slices: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const candidates = paragraph.length <= MAX_PASSAGE_CHARS ? [paragraph] : sentenceBoundaryChunks(paragraph);
    for (const candidate of candidates) {
      if (!hasTerminalSentencePunctuation(candidate) || isLikelyReferenceNoteFragment(candidate)) continue;
      const next = buffer ? `${buffer}\n\n${candidate}` : candidate;
      if (next.length < TARGET_PASSAGE_CHARS) {
        buffer = next;
        continue;
      }
      if (isReadableTextCandidate(next)) {
        slices.push(next);
        buffer = '';
      } else if (isReadableTextCandidate(buffer)) {
        slices.push(buffer);
        buffer = candidate;
      } else {
        buffer = candidate;
      }
      if (slices.length >= maxPassages) break;
    }
    if (slices.length >= maxPassages) break;
  }
  if (slices.length < maxPassages && isReadableTextCandidate(buffer)) {
    slices.push(buffer);
  }
  return slices.slice(0, maxPassages);
}

async function ensureCronTables(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ingest_runs (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      source_url TEXT NOT NULL,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_tag_failures (
      passage_id TEXT PRIMARY KEY NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    )
  `);
}

async function chooseNextBooks(prisma: PrismaClient, maxBooks: number) {
  const selected: BookQueueItem[] = [];
  for (const item of BOOK_QUEUE) {
    const existingPassage = await prisma.passage.findFirst({ where: { bookTitle: item.title, author: item.author } });
    if (existingPassage) continue;
    selected.push(item);
    if (selected.length >= maxBooks) break;
  }
  return selected;
}

async function fetchBookText(book: BookQueueItem) {
  const errors: string[] = [];
  for (const url of book.urls) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'RandomPage/1.0 (+https://randompage.rollersoft.com.au)',
          'accept': 'text/plain,text/*;q=0.9,*/*;q=0.1',
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      if (text.length < 10_000) throw new Error(`too short (${text.length} bytes)`);
      return { text, sourceUrl: url };
    } catch (err) {
      errors.push(`${url}: ${truncate(err, 300)}`);
    }
  }
  throw new Error(`all plaintext sources failed for ${book.slug}: ${errors.join(' | ')}`);
}

async function fetchNewBooks(req: Request, res: Response) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const prisma = getPrisma();
  await ensureCronTables(prisma);
  const maxBooks = numericQuery(req, 'books', Number(process.env.FETCH_BOOKS_LIMIT ?? 1), 1, 3);
  const maxPassages = numericQuery(req, 'passages', Number(process.env.FETCH_BOOK_PASSAGE_LIMIT ?? 75), 10, 200);
  let processed = 0;
  let inserted = 0;
  let failed = 0;

  try {
    const books = await chooseNextBooks(prisma, maxBooks);
    if (books.length === 0) {
      const summary: CronSummary = {
        cron: 'fetch-new-books',
        ok: false,
        processed: 0,
        inserted: 0,
        failed: 0,
        skipped: BOOK_QUEUE.length,
        durationMs: Date.now() - started,
        error: `book queue exhausted: all ${BOOK_QUEUE.length} configured public-domain books already have passages`,
      };
      await notifyPipeline(summary);
      res.status(409).json(summary);
      return;
    }

    for (const book of books) {
      processed++;
      try {
        const { text, sourceUrl } = await fetchBookText(book);
        const passages = slicePassages(text, maxPassages - inserted);
        if (passages.length === 0) throw new Error(`no eligible passages sliced from ${sourceUrl}`);
        for (const passageText of passages) {
          await prisma.passage.create({
            data: {
              id: nanoid(),
              text: passageText,
              bookTitle: book.title,
              author: book.author,
              chapter: null,
              tags: '[]',
              language: book.language ?? 'en',
            },
          });
          inserted++;
          if (inserted >= maxPassages) break;
        }
        await prisma.$executeRawUnsafe(
          'INSERT INTO ingest_runs (id, slug, title, author, source_url, inserted_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          nanoid(), book.slug, book.title, book.author, sourceUrl, passages.length, new Date().toISOString(),
        );
      } catch (err) {
        failed++;
        console.log(`[cron/fetch-new-books] ${book.slug} failed: ${truncate(err)}`);
      }
    }

    const summary: CronSummary = { cron: 'fetch-new-books', ok: failed === 0, processed, inserted, failed, skipped: Math.max(0, maxBooks - processed), durationMs: Date.now() - started };
    await notifyPipeline(summary);
    res.status(summary.ok ? 200 : 207).json(summary);
  } catch (err) {
    const summary: CronSummary = { cron: 'fetch-new-books', ok: false, processed, inserted, failed: failed + 1, durationMs: Date.now() - started, error: truncate(err) };
    await notifyPipeline(summary);
    res.status(500).json(summary);
  }
}

type PassageForTagging = Pick<Passage, 'id' | 'text' | 'bookTitle' | 'author' | 'language'>;

async function loadUntaggedPassages(prisma: PrismaClient, limit: number): Promise<PassageForTagging[]> {
  return await prisma.$queryRawUnsafe(`
    SELECT p.id, p.text, p.book_title AS bookTitle, p.author, p.language
    FROM passages p
    LEFT JOIN passage_tag_failures f ON f.passage_id = p.id
    WHERE (p.tags IS NULL OR p.tags = '' OR p.tags = '[]')
      AND COALESCE(f.retry_count, 0) < 3
    ORDER BY p.rowid ASC
    LIMIT ?
  `, limit) as PassageForTagging[];
}

function normalizeTags(tags: unknown, fallbackLang: string) {
  const values = Array.isArray(tags) ? tags : [];
  const normalized = values
    .map(tag => String(tag).toLowerCase().trim().replace(/\s+/g, '-'))
    .filter(tag => /^[a-z0-9-]{2,32}$/.test(tag))
    .slice(0, 7);
  if (!normalized.includes(fallbackLang)) normalized.push(fallbackLang);
  return Array.from(new Set(normalized)).slice(0, 7);
}

async function tagBatch(passages: PassageForTagging[]) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_IMAGE_GENERATION_ONLY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const prompt = `Tag these literary passages for a recommendation engine. Return ONLY JSON array: [{"id":"...","tags":["genre","mood","topic","language"]}]. Tags must be lowercase, 4-7 items, include one genre, one mood, at least one topic, and language code.\n\n${JSON.stringify(passages.map(p => ({ id: p.id, title: p.bookTitle, author: p.author, language: p.language, text: p.text.slice(0, 1400) })))}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = payload.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(jsonText) as { id: string; tags: unknown }[];
  return new Map(parsed.map(item => [item.id, item.tags]));
}

async function recordTagFailure(prisma: PrismaClient, passageId: string, err: unknown) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO passage_tag_failures (passage_id, retry_count, last_error, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(passage_id) DO UPDATE SET
       retry_count = retry_count + 1,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
    passageId,
    truncate(err, 1000),
    new Date().toISOString(),
  );
}

async function tagUntagged(req: Request, res: Response) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const prisma = getPrisma();
  await ensureCronTables(prisma);
  const limit = numericQuery(req, 'limit', Number(process.env.TAG_UNTAGGED_LIMIT ?? 50), 1, 100);
  const batchSize = numericQuery(req, 'batch', Number(process.env.TAG_UNTAGGED_BATCH ?? 5), 1, 10);
  let processed = 0;
  let tagged = 0;
  let failed = 0;

  try {
    const passages = await loadUntaggedPassages(prisma, limit);
    for (let i = 0; i < passages.length; i += batchSize) {
      const batch = passages.slice(i, i + batchSize);
      processed += batch.length;
      try {
        const results = await tagBatch(batch);
        for (const passage of batch) {
          const tags = normalizeTags(results.get(passage.id), passage.language || 'en');
          if (tags.length < 4) throw new Error(`LLM returned too few tags for ${passage.id}`);
          await prisma.passage.update({ where: { id: passage.id }, data: { tags: JSON.stringify(tags) } });
          await prisma.$executeRawUnsafe('DELETE FROM passage_tag_failures WHERE passage_id = ?', passage.id);
          tagged++;
        }
      } catch (err) {
        failed += batch.length;
        for (const passage of batch) await recordTagFailure(prisma, passage.id, err);
        console.log(`[cron/tag-untagged] batch failed: ${truncate(err)}`);
      }
    }

    const summary: CronSummary = { cron: 'tag-untagged', ok: failed === 0, processed, tagged, failed, skipped: limit - processed > 0 ? limit - processed : 0, durationMs: Date.now() - started };
    await notifyPipeline(summary);
    res.status(summary.ok ? 200 : 207).json(summary);
  } catch (err) {
    const summary: CronSummary = { cron: 'tag-untagged', ok: false, processed, tagged, failed: failed + 1, durationMs: Date.now() - started, error: truncate(err) };
    await notifyPipeline(summary);
    res.status(500).json(summary);
  }
}

cronRouter.get('/cron/fetch-new-books', fetchNewBooks);
cronRouter.post('/cron/fetch-new-books', fetchNewBooks);
cronRouter.get('/cron/tag-untagged', tagUntagged);
cronRouter.post('/cron/tag-untagged', tagUntagged);
