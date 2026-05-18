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
  url: string;
  language?: string;
};

const BOOK_QUEUE: BookQueueItem[] = [
  {
    slug: 'jane-austen-pride-and-prejudice',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    url: 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
    language: 'en',
  },
  {
    slug: 'mary-shelley-frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    url: 'https://www.gutenberg.org/cache/epub/84/pg84.txt',
    language: 'en',
  },
  {
    slug: 'frederick-douglass-narrative',
    title: 'Narrative of the Life of Frederick Douglass',
    author: 'Frederick Douglass',
    url: 'https://www.gutenberg.org/cache/epub/23/pg23.txt',
    language: 'en',
  },
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

function slicePassages(raw: string, maxPassages: number) {
  const clean = stripBoilerplate(raw);
  const paragraphs = clean
    .split(/\n\s*\n/g)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 220 && p.length <= 2200 && !isLikelyBoilerplate(p));

  const slices: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    const words = next.split(/\s+/).length;
    if (words < 220) {
      buffer = next;
      continue;
    }
    slices.push(next);
    buffer = '';
    if (slices.length >= maxPassages) break;
  }
  return slices;
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
    for (const book of books) {
      processed++;
      try {
        const response = await fetch(book.url);
        if (!response.ok) throw new Error(`fetch ${response.status} ${response.statusText}`);
        const text = await response.text();
        const passages = slicePassages(text, maxPassages - inserted);
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
          nanoid(), book.slug, book.title, book.author, book.url, passages.length, new Date().toISOString(),
        );
      } catch (err) {
        failed++;
        console.log(`[cron/fetch-new-books] ${book.slug} failed: ${truncate(err)}`);
      }
    }

    const summary: CronSummary = { cron: 'fetch-new-books', ok: failed === 0, processed, inserted, failed, skipped: 0, durationMs: Date.now() - started };
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
