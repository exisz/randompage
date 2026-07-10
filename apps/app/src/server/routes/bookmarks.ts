import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';
import { parsePassageTags } from '../lib/passageTags.js';
import { computeReviewSchedule, deriveBoxFromHistory, type ReviewAction } from '../lib/spacedReview.js';
import { scoreRecallPassages, scoreRelatedSavedPassages, type RecallSearchPassageInput } from '../lib/recallSearch.js';
import { parseReviewTuning, tuneDueBookmarks } from '../lib/reviewTuning.js';

export const bookmarksRouter = Router();

async function ensureBookmarkCollectionTables(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bookmark_collections (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  const collectionColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info(bookmark_collections)');
  if (!collectionColumns.some((column) => column.name === 'purpose')) {
    await prisma.$executeRawUnsafe('ALTER TABLE bookmark_collections ADD COLUMN purpose TEXT');
  }
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS bookmark_collections_user_updated_idx ON bookmark_collections(user_id, updated_at)');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS bookmark_collections_user_name_key ON bookmark_collections(user_id, name)');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bookmark_collection_items (
      id TEXT PRIMARY KEY NOT NULL,
      collection_id TEXT NOT NULL,
      bookmark_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES bookmark_collections(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS bookmark_collection_items_collection_bookmark_key ON bookmark_collection_items(collection_id, bookmark_id)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS bookmark_collection_items_bookmark_idx ON bookmark_collection_items(bookmark_id)');
}


// PLANET-3477: private book-level want-to-read shelf over discovered RandomPage sources.
async function ensureSavedBookTable(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS saved_books (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'want_to_read',
      saved_from_passage_id TEXT,
      source_url TEXT,
      isbn13 TEXT,
      isbn10 TEXT,
      source TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (saved_from_passage_id) REFERENCES passages(id) ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info(saved_books)');
  for (const [name, type] of [['isbn13', 'TEXT'], ['isbn10', 'TEXT'], ['source', 'TEXT']] as const) {
    if (!columns.some((column) => column.name === name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE saved_books ADD COLUMN ${name} ${type}`);
    }
  }
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS saved_books_user_source_key ON saved_books(user_id, title, author)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS saved_books_user_saved_idx ON saved_books(user_id, saved_at)');
}

function normalizeSavedBookText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeSavedBookStatus(value: unknown) {
  return value === 'read' ? 'read' : 'want_to_read';
}

function normalizeIsbn(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.toUpperCase().replace(/[^0-9X]/g, '');
  return cleaned.length === 10 || cleaned.length === 13 ? cleaned : undefined;
}

function compactTag(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function normalizeMetadataTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => compactTag(String(item))).filter(Boolean))).slice(0, 6);
}

function firstText(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function lookupOpenLibraryIsbn(isbn: string) {
  const url = `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`;
  const response = await fetch(url, { headers: { 'user-agent': 'RandomPage/1.0 (isbn-source-interest)' } });
  if (!response.ok) return null;
  const data = await response.json() as Record<string, unknown>;
  const authorNames: string[] = [];
  const authors = Array.isArray(data.authors) ? data.authors : [];
  for (const author of authors.slice(0, 3)) {
    const key = typeof author === 'object' && author && typeof (author as { key?: unknown }).key === 'string' ? (author as { key: string }).key : '';
    if (!key) continue;
    try {
      const authorResponse = await fetch(`https://openlibrary.org${key}.json`, { headers: { 'user-agent': 'RandomPage/1.0 (isbn-source-interest)' } });
      if (authorResponse.ok) {
        const authorData = await authorResponse.json() as { name?: unknown };
        if (typeof authorData.name === 'string') authorNames.push(authorData.name);
      }
    } catch {
      // Metadata lookup remains best-effort; title-only preview is still useful.
    }
  }
  const title = firstText(data.title);
  if (!title) return null;
  const isbn13 = firstText(data.isbn_13) ?? (isbn.length === 13 ? isbn : undefined);
  const isbn10 = firstText(data.isbn_10) ?? (isbn.length === 10 ? isbn : undefined);
  return {
    title,
    author: authorNames.join(', '),
    isbn13,
    isbn10,
    coverUrl: isbn13 || isbn10 ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn13 ?? isbn10 ?? isbn)}-M.jpg` : null,
    sourceUrl: `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}`,
    tags: normalizeMetadataTags(data.subjects),
    provider: 'openlibrary',
  };
}

const SOURCE_NOTICE_PREFIX = 'control:source-notify:';

function sourceNoticeKey(title: string, author: string) {
  return `${SOURCE_NOTICE_PREFIX}${encodeURIComponent(`${title.trim()}::${author.trim()}`)}`;
}

function savedBookRowToJson(row: {
  id: string; title: string; author: string; status: string; saved_from_passage_id: string | null; source_url: string | null; isbn13?: string | null; isbn10?: string | null; source?: string | null; tags: string | null; saved_at: string; updated_at: string;
  notify_enabled?: number | null; unnotified_count?: number | null; notice_passage_id?: string | null; notice_passage_text?: string | null; notice_passage_title?: string | null; notice_passage_author?: string | null; notice_passage_chapter?: string | null; notice_passage_tags?: string | null; notice_passage_language?: string | null;
  passage_text?: string | null; passage_title?: string | null; passage_author?: string | null; passage_chapter?: string | null; passage_tags?: string | null; passage_language?: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    status: row.status,
    savedFromPassageId: row.saved_from_passage_id,
    sourceUrl: row.source_url,
    isbn13: row.isbn13 ?? null,
    isbn10: row.isbn10 ?? null,
    source: row.source ?? null,
    tags: row.tags ?? '[]',
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    notifyOnNewPassages: Number(row.notify_enabled ?? 0) > 0,
    newPassageNotice: Number(row.notify_enabled ?? 0) > 0 && Number(row.unnotified_count ?? 0) > 0 && row.notice_passage_id ? {
      count: Number(row.unnotified_count ?? 0),
      passage: {
        id: row.notice_passage_id,
        text: row.notice_passage_text ?? '',
        bookTitle: row.notice_passage_title ?? row.title,
        author: row.notice_passage_author ?? row.author,
        chapter: row.notice_passage_chapter ?? undefined,
        tags: row.notice_passage_tags ?? '[]',
        language: row.notice_passage_language ?? 'en',
      },
    } : null,
    savedFromPassage: row.saved_from_passage_id && row.passage_text ? {
      id: row.saved_from_passage_id,
      text: row.passage_text,
      bookTitle: row.passage_title ?? row.title,
      author: row.passage_author ?? row.author,
      chapter: row.passage_chapter ?? undefined,
      tags: row.passage_tags ?? row.tags ?? '[]',
      language: row.passage_language ?? 'en',
    } : null,
  };
}

async function ensureBookmarkNotesColumn(prisma: ReturnType<typeof getPrisma>) {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info(bookmarks)');
  if (!columns.some((column) => column.name === 'note')) {
    await prisma.$executeRawUnsafe('ALTER TABLE bookmarks ADD COLUMN note TEXT');
  }
}

async function ensurePassageReviewTable(prisma: ReturnType<typeof getPrisma>) {
  await ensureBookmarkCollectionTables(prisma);
  await ensureBookmarkNotesColumn(prisma);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      bookmark_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      due_after TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_reviews_user_due_idx ON passage_reviews(user_id, due_after)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_reviews_bookmark_reviewed_idx ON passage_reviews(bookmark_id, reviewed_at)');
  await ensurePassageReviewBoxColumn(prisma);
  await ensurePassageAnnotationTable(prisma);
  await ensurePassageRecallCardTables(prisma);
}

// PLANET-3015: spaced-repetition box/interval index for increasing-interval scheduling.
async function ensurePassageReviewBoxColumn(prisma: ReturnType<typeof getPrisma>) {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info(passage_reviews)');
  if (!columns.some((column) => column.name === 'box')) {
    await prisma.$executeRawUnsafe('ALTER TABLE passage_reviews ADD COLUMN box INTEGER');
  }
}

// PLANET-3093: private line-level thoughts anchored to exact text ranges inside saved passages.
async function ensurePassageAnnotationTable(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_annotations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      bookmark_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_annotations_user_bookmark_idx ON passage_annotations(user_id, bookmark_id)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_annotations_passage_idx ON passage_annotations(passage_id)');
}

// PLANET-3146: private active-recall cloze cards over saved RandomPage passages.
async function ensurePassageRecallCardTables(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_recall_cards (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      bookmark_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      context_before TEXT NOT NULL,
      context_after TEXT NOT NULL,
      due_after TEXT NOT NULL,
      box INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_recall_cards_user_due_idx ON passage_recall_cards(user_id, due_after)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_recall_cards_bookmark_idx ON passage_recall_cards(bookmark_id)');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS passage_recall_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      recall_card_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      due_after TEXT NOT NULL,
      box INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (recall_card_id) REFERENCES passage_recall_cards(id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS passage_recall_reviews_card_reviewed_idx ON passage_recall_reviews(recall_card_id, reviewed_at)');
}

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

async function ensureUserRow(prisma: ReturnType<typeof getPrisma>, userId: string, displayName = 'Reader') {
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO users (id, display_name, created_at)
    VALUES (${userId}, ${displayName}, ${epochSeconds(new Date())})
  `;
}

function normalizeCollectionName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
}

function normalizeCollectionPurpose(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 160) : null;
}

async function requireOwnedBookmark(prisma: ReturnType<typeof getPrisma>, userId: string, bookmarkId: string) {
  const bookmark = await prisma.bookmark.findFirst({ where: { id: bookmarkId, userId } });
  return bookmark;
}

function normalizeBookmarkNote(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1200) : null;
}

function normalizeAnnotationText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function validateAnnotationAnchor(passageText: string, quote: string, startOffset: unknown, endOffset: unknown) {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return { error: 'startOffset and endOffset must be integers' };
  const start = Number(startOffset);
  const end = Number(endOffset);
  if (start < 0 || end <= start || end > passageText.length) return { error: 'annotation offsets are outside the passage text' };
  const anchoredQuote = passageText.slice(start, end).trim();
  if (!anchoredQuote || anchoredQuote !== quote.trim()) return { error: 'quote must match the selected passage text range' };
  return { start, end };
}

function buildRecallContext(passageText: string, startOffset: number, endOffset: number) {
  return {
    contextBefore: passageText.slice(Math.max(0, startOffset - 180), startOffset),
    contextAfter: passageText.slice(endOffset, Math.min(passageText.length, endOffset + 180)),
  };
}

function normalizeRecallReviewAction(value: unknown): 'remembered' | 'forgot' | 'soon' | 'later' | 'someday' {
  return value === 'forgot' || value === 'soon' || value === 'later' || value === 'someday' ? value : 'remembered';
}

function computeRecallReviewSchedule(previousBox: number | null, action: 'remembered' | 'forgot' | 'soon' | 'later' | 'someday', now: Date) {
  if (action === 'someday') {
    const dueAfter = new Date(now);
    dueAfter.setDate(dueAfter.getDate() + 60);
    return { box: 5, intervalDays: 60, dueAfter };
  }
  const reviewAction: ReviewAction = action === 'remembered' ? 'reviewed' : action === 'later' ? 'review_later' : 'skip';
  return computeReviewSchedule(previousBox, reviewAction, now);
}

async function requireOwnedCollection(prisma: ReturnType<typeof getPrisma>, userId: string, collectionId: string) {
  const collection = await prisma.bookmarkCollection.findFirst({ where: { id: collectionId, userId } });
  return collection;
}

// GET /api/bookmarks
bookmarksRouter.get('/bookmarks', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: claims.sub as string },
      include: {
        passage: true,
        collectionItems: { include: { collection: true } },
        passageReviews: { orderBy: { reviewedAt: 'desc' }, take: 1 },
        annotations: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ bookmarks });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


// GET /api/saved-books — private want-to-read shelf for discovered books/sources.
bookmarksRouter.get('/saved-books', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    const userId = claims.sub as string;
    const rows = await prisma.$queryRaw<Array<{
      id: string; title: string; author: string; status: string; saved_from_passage_id: string | null; source_url: string | null; isbn13: string | null; isbn10: string | null; source: string | null; tags: string | null; saved_at: string; updated_at: string;
      notify_enabled: number | null; unnotified_count: number | null; notice_passage_id: string | null; notice_passage_text: string | null; notice_passage_title: string | null; notice_passage_author: string | null; notice_passage_chapter: string | null; notice_passage_tags: string | null; notice_passage_language: string | null;
      passage_text: string | null; passage_title: string | null; passage_author: string | null; passage_chapter: string | null; passage_tags: string | null; passage_language: string | null;
    }>>`
      SELECT sb.id, sb.title, sb.author, sb.status, sb.saved_from_passage_id, sb.source_url, sb.isbn13, sb.isbn10, sb.source, sb.tags, sb.saved_at, sb.updated_at,
             0 AS notify_enabled,
             (SELECT COUNT(*) FROM passages np
              WHERE lower(np.book_title) = lower(sb.title)
                AND lower(COALESCE(np.author, '')) = lower(COALESCE(sb.author, ''))
                AND (sb.saved_from_passage_id IS NULL OR np.id != sb.saved_from_passage_id)
                AND NOT EXISTS (SELECT 1 FROM push_history ph WHERE ph.user_id = sb.user_id AND ph.passage_id = np.id)
             ) AS unnotified_count,
             npick.id AS notice_passage_id, npick.text AS notice_passage_text, npick.book_title AS notice_passage_title, npick.author AS notice_passage_author, npick.chapter AS notice_passage_chapter, npick.tags AS notice_passage_tags, npick.language AS notice_passage_language,
             p.text AS passage_text, p.book_title AS passage_title, p.author AS passage_author, p.chapter AS passage_chapter, p.tags AS passage_tags, p.language AS passage_language
      FROM saved_books sb
      LEFT JOIN passages p ON p.id = sb.saved_from_passage_id
      LEFT JOIN passages npick ON npick.id = (
        SELECT np.id FROM passages np
        WHERE lower(np.book_title) = lower(sb.title)
          AND lower(COALESCE(np.author, '')) = lower(COALESCE(sb.author, ''))
          AND (sb.saved_from_passage_id IS NULL OR np.id != sb.saved_from_passage_id)
          AND NOT EXISTS (SELECT 1 FROM push_history ph WHERE ph.user_id = sb.user_id AND ph.passage_id = np.id)
        ORDER BY np.id LIMIT 1
      )
      WHERE sb.user_id = ${userId}
      ORDER BY CASE WHEN sb.status = 'want_to_read' THEN 0 ELSE 1 END, sb.saved_at DESC
      LIMIT 100
    `;
    const noticePrefs = await prisma.userPreference.findMany({ where: { userId, tag: { startsWith: SOURCE_NOTICE_PREFIX } }, select: { tag: true } });
    const noticeTags = new Set(noticePrefs.map((pref) => pref.tag));
    for (const row of rows) row.notify_enabled = noticeTags.has(sourceNoticeKey(row.title, row.author)) ? 1 : 0;
    res.json({ savedBooks: rows.map(savedBookRowToJson) });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/saved-books/isbn/lookup?isbn=... — anonymous-safe metadata preview for physical books.
bookmarksRouter.get('/saved-books/isbn/lookup', async (req: Request, res: Response) => {
  try {
    const isbn = normalizeIsbn(req.query.isbn);
    if (!isbn) { res.status(400).json({ error: 'Enter a valid ISBN-10 or ISBN-13.' }); return; }
    const metadata = await lookupOpenLibraryIsbn(isbn);
    if (!metadata) { res.status(404).json({ error: 'No public metadata found for that ISBN yet.' }); return; }
    const prisma = getPrisma();
    const matches = await prisma.$queryRaw<Array<{ id: string; text: string; bookTitle: string; author: string; chapter: string | null; tags: string; language: string }>>`
      SELECT id, text, book_title AS bookTitle, author, chapter, tags, language
      FROM passages
      WHERE lower(book_title) = lower(${metadata.title})
        AND (${metadata.author} = '' OR lower(COALESCE(author, '')) = lower(${metadata.author}))
      ORDER BY id LIMIT 5
    `;
    res.json({ isbn, metadata, matchingPassages: matches, matchingCount: matches.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/saved-books — idempotently save a title/author to the signed-in user's want-to-read shelf.
bookmarksRouter.post('/saved-books', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    const userId = claims.sub as string;
    await ensureUserRow(prisma, userId);

    let title = normalizeSavedBookText(req.body?.title, 180);
    let author = normalizeSavedBookText(req.body?.author, 120) ?? '';
    const passageId = normalizeSavedBookText(req.body?.passageId, 80);
    const sourceUrl = normalizeSavedBookText(req.body?.sourceUrl, 500) ?? null;
    const isbn13 = normalizeIsbn(req.body?.isbn13) ?? null;
    const isbn10 = normalizeIsbn(req.body?.isbn10) ?? null;
    const source = normalizeSavedBookText(req.body?.source, 40) ?? (isbn13 || isbn10 ? 'isbn-scan' : null);
    let tags = JSON.stringify(normalizeMetadataTags(req.body?.tags));

    if (passageId) {
      const passage = await prisma.passage.findUnique({ where: { id: passageId } });
      if (!passage) { res.status(404).json({ error: 'Passage not found' }); return; }
      title = title ?? passage.bookTitle;
      author = author || passage.author || '';
      tags = JSON.stringify(Array.from(new Set([...parsePassageTags(passage.tags), ...normalizeMetadataTags(req.body?.tags)])));
    }
    if (!title) { res.status(400).json({ error: 'title required' }); return; }

    const now = new Date().toISOString();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM saved_books WHERE user_id = ${userId} AND title = ${title} AND author = ${author} LIMIT 1
    `;
    const existing = rows[0];
    const id = existing?.id ?? nanoid();
    if (existing) {
      await prisma.$executeRaw`
        UPDATE saved_books
        SET status = 'want_to_read', saved_from_passage_id = COALESCE(${passageId ?? null}, saved_from_passage_id), source_url = COALESCE(${sourceUrl}, source_url), isbn13 = COALESCE(${isbn13}, isbn13), isbn10 = COALESCE(${isbn10}, isbn10), source = COALESCE(${source}, source), tags = ${tags}, saved_at = ${now}, updated_at = ${now}
        WHERE id = ${id} AND user_id = ${userId}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO saved_books (id, user_id, title, author, status, saved_from_passage_id, source_url, isbn13, isbn10, source, tags, saved_at, updated_at)
        VALUES (${id}, ${userId}, ${title}, ${author}, 'want_to_read', ${passageId ?? null}, ${sourceUrl}, ${isbn13}, ${isbn10}, ${source}, ${tags}, ${now}, ${now})
      `;
    }

    const parsedTags = Array.from(new Set([...(JSON.parse(tags) as string[]), ...(source === 'isbn-scan' ? ['isbn-scan'] : [])]));
    const updatedAt = epochSeconds(new Date(now));
    for (const tag of parsedTags.slice(0, 8)) {
      const preferenceTag = `book:${tag}`;
      const existingPref = await prisma.$queryRaw<Array<{ id: string; weight: number }>>`
        SELECT id, weight FROM user_preferences WHERE user_id = ${userId} AND tag = ${preferenceTag} LIMIT 1
      `;
      if (existingPref[0]) {
        await prisma.$executeRaw`UPDATE user_preferences SET weight = ${Math.min(Number(existingPref[0].weight) + 1, 12)}, updated_at = ${updatedAt} WHERE id = ${existingPref[0].id}`;
      } else {
        await prisma.$executeRaw`INSERT INTO user_preferences (id, user_id, tag, weight, updated_at) VALUES (${nanoid()}, ${userId}, ${preferenceTag}, ${2}, ${updatedAt})`;
      }
    }

    const savedRows = await prisma.$queryRaw<Array<{
      id: string; title: string; author: string; status: string; saved_from_passage_id: string | null; source_url: string | null; isbn13: string | null; isbn10: string | null; source: string | null; tags: string | null; saved_at: string; updated_at: string;
      passage_text: string | null; passage_title: string | null; passage_author: string | null; passage_chapter: string | null; passage_tags: string | null; passage_language: string | null;
    }>>`
      SELECT sb.id, sb.title, sb.author, sb.status, sb.saved_from_passage_id, sb.source_url, sb.isbn13, sb.isbn10, sb.source, sb.tags, sb.saved_at, sb.updated_at,
             p.text AS passage_text, p.book_title AS passage_title, p.author AS passage_author, p.chapter AS passage_chapter, p.tags AS passage_tags, p.language AS passage_language
      FROM saved_books sb LEFT JOIN passages p ON p.id = sb.saved_from_passage_id
      WHERE sb.id = ${id} AND sb.user_id = ${userId}
      LIMIT 1
    `;
    res.json({ savedBook: savedBookRowToJson(savedRows[0]) });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /api/saved-books/:id/notifications — signed-in private source notice toggle.
bookmarksRouter.patch('/saved-books/:id/notifications', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    const userId = claims.sub as string;
    const rows = await prisma.$queryRaw<Array<{ id: string; title: string; author: string }>>`
      SELECT id, title, author FROM saved_books WHERE id = ${req.params.id} AND user_id = ${userId} LIMIT 1
    `;
    const book = rows[0];
    if (!book) { res.status(404).json({ error: 'Saved book not found' }); return; }
    const tag = sourceNoticeKey(book.title, book.author);
    if (req.body?.enabled === false) {
      await prisma.$executeRaw`DELETE FROM user_preferences WHERE user_id = ${userId} AND tag = ${tag}`;
      res.json({ ok: true, enabled: false });
      return;
    }
    const now = new Date();
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM user_preferences WHERE user_id = ${userId} AND tag = ${tag} LIMIT 1`;
    if (existing[0]) {
      await prisma.$executeRaw`UPDATE user_preferences SET weight = ${1}, updated_at = ${now} WHERE id = ${existing[0].id}`;
    } else {
      await prisma.$executeRaw`INSERT INTO user_preferences (id, user_id, tag, weight, updated_at) VALUES (${nanoid()}, ${userId}, ${tag}, ${1}, ${now})`;
    }
    res.json({ ok: true, enabled: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/saved-books/notices — private newly available source-passage notices.
bookmarksRouter.get('/saved-books/notices', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    const userId = claims.sub as string;
    const prefs = await prisma.userPreference.findMany({ where: { userId, tag: { startsWith: SOURCE_NOTICE_PREFIX } }, select: { tag: true } });
    if (prefs.length === 0) { res.json({ notices: [] }); return; }
    const prefTags = new Set(prefs.map((pref) => pref.tag));
    const books = await prisma.$queryRaw<Array<{ id: string; title: string; author: string; saved_from_passage_id: string | null }>>`
      SELECT id, title, author, saved_from_passage_id FROM saved_books WHERE user_id = ${userId} ORDER BY saved_at DESC LIMIT 100
    `;
    const notices = [];
    for (const book of books) {
      if (!prefTags.has(sourceNoticeKey(book.title, book.author))) continue;
      const matches = await prisma.$queryRaw<Array<{ id: string; text: string; bookTitle: string; author: string; chapter: string | null; tags: string; language: string }>>`
        SELECT p.id, p.text, p.book_title as bookTitle, p.author, p.chapter, p.tags, p.language
        FROM passages p
        WHERE lower(p.book_title) = lower(${book.title})
          AND lower(COALESCE(p.author, '')) = lower(${book.author})
          AND (${book.saved_from_passage_id} IS NULL OR p.id != ${book.saved_from_passage_id})
          AND NOT EXISTS (SELECT 1 FROM push_history ph WHERE ph.user_id = ${userId} AND ph.passage_id = p.id)
        ORDER BY p.id
        LIMIT 3
      `;
      if (matches.length) notices.push({ savedBookId: book.id, title: book.title, author: book.author, count: matches.length, passages: matches });
    }
    res.json({ notices });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /api/saved-books/:id — mark a saved book as read or back to want-to-read.
bookmarksRouter.patch('/saved-books/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    const userId = claims.sub as string;
    const status = normalizeSavedBookStatus(req.body?.status);
    const now = new Date().toISOString();
    const result = await prisma.$executeRaw`UPDATE saved_books SET status = ${status}, updated_at = ${now} WHERE id = ${req.params.id} AND user_id = ${userId}`;
    if (Number(result) === 0) { res.status(404).json({ error: 'Saved book not found' }); return; }
    res.json({ ok: true, status });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/saved-books/:id — remove a private saved-book row.
bookmarksRouter.delete('/saved-books/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureSavedBookTable(prisma);
    await prisma.$executeRaw`DELETE FROM saved_books WHERE id = ${req.params.id} AND user_id = ${claims.sub as string}`;
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/bookmarks/recall-search?q=... — fuzzy idea search over the user's own library/history.
bookmarksRouter.get('/bookmarks/recall-search', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 160) : '';
    if (q.length < 2) { res.json({ query: q, results: [] }); return; }
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;

    const [bookmarks, browsingEvents, pushHistory] = await Promise.all([
      prisma.bookmark.findMany({
        where: { userId },
        include: { passage: true, collectionItems: { include: { collection: true } }, annotations: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.browsingEvent.findMany({
        where: { userId, action: { in: ['view', 'more_like_this'] } },
        include: { passage: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.pushHistory.findMany({
        where: { userId },
        include: { passage: true },
        orderBy: { sentAt: 'desc' },
        take: 120,
      }),
    ]);

    const candidates = new Map<string, RecallSearchPassageInput>();
    const upsertCandidate = (input: RecallSearchPassageInput) => {
      const existing = candidates.get(input.id);
      if (!existing) { candidates.set(input.id, input); return; }
      const sources = Array.from(new Set([...(existing.sources ?? []), ...(input.sources ?? [])]));
      const collections = Array.from(new Set([...(existing.collections ?? []), ...(input.collections ?? [])]));
      const collectionPurposes = Array.from(new Set([...(existing.collectionPurposes ?? []), ...(input.collectionPurposes ?? [])]));
      candidates.set(input.id, {
        ...existing,
        note: existing.note ?? input.note,
        collections,
        collectionPurposes,
        sources,
      });
    };

    for (const bookmark of bookmarks) {
      upsertCandidate({
        ...bookmark.passage,
        note: bookmark.note,
        annotations: bookmark.annotations.map(annotation => ({ quote: annotation.quote, note: annotation.note })),
        collections: bookmark.collectionItems.map(item => item.collection.name),
        collectionPurposes: bookmark.collectionItems.map(item => item.collection.purpose).filter((purpose): purpose is string => Boolean(purpose)),
        sources: ['bookmark'],
      });
    }
    for (const event of browsingEvents) upsertCandidate({ ...event.passage, sources: ['history'] });
    for (const push of pushHistory) upsertCandidate({ ...push.passage, sources: ['push inbox'] });

    const results = scoreRecallPassages(q, Array.from(candidates.values()), 10);
    res.json({ query: q, results });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/bookmarks/:id/related — deterministic related saved passages from the current review card.
bookmarksRouter.get('/bookmarks/:id/related', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;

    const currentBookmark = await prisma.bookmark.findFirst({
      where: { id: req.params.id, userId },
      include: {
        passage: true,
        collectionItems: { include: { collection: true } },
        annotations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!currentBookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId },
      include: {
        passage: true,
        collectionItems: { include: { collection: true } },
        annotations: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 240,
    });

    const toInput = (bookmark: typeof currentBookmark): RecallSearchPassageInput => ({
      ...bookmark.passage,
      bookmarkId: bookmark.id,
      note: bookmark.note,
      annotations: bookmark.annotations.map(annotation => ({ quote: annotation.quote, note: annotation.note })),
      collections: bookmark.collectionItems.map(item => item.collection.name),
      collectionPurposes: bookmark.collectionItems.map(item => item.collection.purpose).filter((purpose): purpose is string => Boolean(purpose)),
      sources: ['bookmark'],
    });

    const current = toInput(currentBookmark);
    const candidates = bookmarks.map(toInput);
    const results = scoreRelatedSavedPassages(current, candidates, 5);
    res.json({ bookmarkId: currentBookmark.id, passageId: currentBookmark.passageId, results });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/bookmark-collections
bookmarksRouter.get('/bookmark-collections', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const collections = await prisma.bookmarkCollection.findMany({
      where: { userId: claims.sub as string },
      include: { items: { select: { bookmarkId: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ collections });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bookmark-collections
bookmarksRouter.post('/bookmark-collections', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const name = normalizeCollectionName(req.body?.name);
    const purpose = normalizeCollectionPurpose(req.body?.purpose) ?? null;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const userId = claims.sub as string;
    const now = new Date();
    await ensureUserRow(prisma, userId);
    const collection = await prisma.bookmarkCollection.create({
      data: { id: nanoid(), userId, name, purpose, createdAt: now, updatedAt: now },
      include: { items: { select: { bookmarkId: true } } },
    });
    res.json({ collection });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /api/bookmark-collections/:id
bookmarksRouter.patch('/bookmark-collections/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const name = normalizeCollectionName(req.body?.name);
    const requestedPurpose = normalizeCollectionPurpose(req.body?.purpose);
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const userId = claims.sub as string;
    const collection = await requireOwnedCollection(prisma, userId, req.params.id);
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return; }
    const updated = await prisma.bookmarkCollection.update({
      where: { id: collection.id },
      data: { name, purpose: requestedPurpose === undefined ? collection.purpose : requestedPurpose, updatedAt: new Date() },
      include: { items: { select: { bookmarkId: true } } },
    });
    res.json({ collection: updated });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/bookmark-collections/:id
bookmarksRouter.delete('/bookmark-collections/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const userId = claims.sub as string;
    const collection = await requireOwnedCollection(prisma, userId, req.params.id);
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return; }
    await prisma.bookmarkCollection.delete({ where: { id: collection.id } });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bookmark-collections/:id/bookmarks
bookmarksRouter.post('/bookmark-collections/:id/bookmarks', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const bookmarkId = typeof req.body?.bookmarkId === 'string' ? req.body.bookmarkId : '';
    if (!bookmarkId) { res.status(400).json({ error: 'bookmarkId required' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    await ensureBookmarkNotesColumn(prisma);
    const userId = claims.sub as string;
    const [collection, bookmark] = await Promise.all([
      requireOwnedCollection(prisma, userId, req.params.id),
      requireOwnedBookmark(prisma, userId, bookmarkId),
    ]);
    if (!collection || !bookmark) { res.status(404).json({ error: 'Collection or bookmark not found' }); return; }
    const existing = await prisma.bookmarkCollectionItem.findFirst({
      where: { collectionId: collection.id, bookmarkId: bookmark.id },
    });
    if (!existing) {
      await prisma.bookmarkCollectionItem.create({
        data: { id: nanoid(), collectionId: collection.id, bookmarkId: bookmark.id, createdAt: new Date() },
      });
    }
    await prisma.bookmarkCollection.update({ where: { id: collection.id }, data: { updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/bookmark-collections/:id/bookmarks/:bookmarkId
bookmarksRouter.delete('/bookmark-collections/:id/bookmarks/:bookmarkId', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    await ensureBookmarkNotesColumn(prisma);
    const userId = claims.sub as string;
    const [collection, bookmark] = await Promise.all([
      requireOwnedCollection(prisma, userId, req.params.id),
      requireOwnedBookmark(prisma, userId, req.params.bookmarkId),
    ]);
    if (!collection || !bookmark) { res.status(404).json({ error: 'Collection or bookmark not found' }); return; }
    await prisma.bookmarkCollectionItem.deleteMany({
      where: { collectionId: collection.id, bookmarkId: bookmark.id },
    });
    await prisma.bookmarkCollection.update({ where: { id: collection.id }, data: { updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/daily-review — resurface 1–3 saved passages due for revisit
bookmarksRouter.get('/daily-review', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const now = new Date();

    const [bookmarks, preferences] = await Promise.all([
      prisma.bookmark.findMany({
        where: { userId },
        include: {
          passage: true,
          passageReviews: { orderBy: { reviewedAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      prisma.userPreference.findMany({ where: { userId } }),
    ]);
    const reviewTuning = parseReviewTuning(preferences);

    const due = tuneDueBookmarks(bookmarks, reviewTuning, now)
      .slice(0, 3)
      .map(({ bookmark, tuning }, index) => ({
        id: bookmark.id,
        bookmarkId: bookmark.id,
        passageId: bookmark.passageId,
        reviewPosition: index + 1,
        lastReviewedAt: bookmark.passageReviews[0]?.reviewedAt ?? null,
        note: bookmark.note ?? null,
        passage: bookmark.passage,
        tuningReason: tuning.reason,
      }));

    res.json({ items: due, generatedFor: now.toISOString().slice(0, 10), reviewTuning });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/daily-review/:bookmarkId — keep/review or dismiss a due saved passage
bookmarksRouter.post('/daily-review/:bookmarkId', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const requestedAction = String(req.body?.action || 'reviewed');
    const action = requestedAction === 'skip' || requestedAction === 'review_later' ? requestedAction : 'reviewed';
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const bookmark = await prisma.bookmark.findFirst({
      where: { id: req.params.bookmarkId, userId },
      include: { passage: true },
    });
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }

    const now = new Date();
    // PLANET-3015: increasing-interval spaced repetition. Derive the previous box from this
    // bookmark's most recent review (or its legacy streak) and advance/step the ladder.
    const priorReviews = await prisma.passageReview.findMany({
      where: { userId, bookmarkId: bookmark.id },
      orderBy: { reviewedAt: 'desc' },
      take: 8,
      select: { action: true, box: true },
    });
    const previousBox = deriveBoxFromHistory(priorReviews);
    const schedule = computeReviewSchedule(previousBox, action as ReviewAction, now);
    const dueAfter = schedule.dueAfter;
    const reviewId = nanoid();
    // Persist box alongside the existing columns; box lives outside the Prisma model, so write raw.
    await prisma.$executeRaw`
      INSERT INTO passage_reviews (id, user_id, bookmark_id, passage_id, action, reviewed_at, due_after, box)
      VALUES (${reviewId}, ${userId}, ${bookmark.id}, ${bookmark.passageId}, ${action}, ${now.toISOString()}, ${dueAfter.toISOString()}, ${schedule.box})
    `;
    const review = {
      id: reviewId,
      userId,
      bookmarkId: bookmark.id,
      passageId: bookmark.passageId,
      action,
      reviewedAt: now.toISOString(),
      dueAfter: dueAfter.toISOString(),
      box: schedule.box,
      intervalDays: schedule.intervalDays,
    };
    res.json({ review });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bookmarks
bookmarksRouter.post('/bookmarks', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const { passageId } = req.body;
    if (!passageId) { res.status(400).json({ error: 'passageId required' }); return; }
    const prisma = getPrisma();

    // Ensure user exists. Production legacy users/bookmarks store created_at as INTEGER unix seconds.
    const userId = claims.sub as string;
    const now = new Date();
    await ensureUserRow(prisma, userId);

    // Update preferences for passage tags. Production user_preferences.updated_at is INTEGER unix seconds.
    const passage = await prisma.passage.findUnique({ where: { id: passageId } });
    if (passage) {
      const tags = parsePassageTags(passage.tags);
      const updatedAt = epochSeconds(now);
      for (const tag of tags) {
        const existing = await prisma.$queryRaw<Array<{ id: string; weight: number }>>`
          SELECT id, weight FROM user_preferences WHERE user_id = ${userId} AND tag = ${tag} LIMIT 1
        `;
        if (existing[0]) {
          await prisma.$executeRaw`
            UPDATE user_preferences
            SET weight = ${Number(existing[0].weight) + 1}, updated_at = ${updatedAt}
            WHERE id = ${existing[0].id}
          `;
        } else {
          await prisma.$executeRaw`
            INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
            VALUES (${nanoid()}, ${userId}, ${tag}, ${2}, ${updatedAt})
          `;
        }
      }
    }

    await ensureBookmarkNotesColumn(prisma);
    const bookmarkId = nanoid();
    await prisma.$executeRaw`
      INSERT INTO bookmarks (id, user_id, passage_id, created_at, note)
      VALUES (${bookmarkId}, ${userId}, ${passageId}, ${epochSeconds(now)}, ${null})
    `;
    res.json({ bookmark: { id: bookmarkId, userId, passageId, createdAt: now.toISOString(), note: null } });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /api/bookmarks/:id/note
bookmarksRouter.patch('/bookmarks/:id/note', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const note = normalizeBookmarkNote(req.body?.note);
    if (note === undefined) { res.status(400).json({ error: 'note must be a string or null' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkNotesColumn(prisma);
    const userId = claims.sub as string;
    const bookmark = await requireOwnedBookmark(prisma, userId, req.params.id);
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }
    await prisma.bookmark.update({ where: { id: bookmark.id }, data: { note } });
    const updated = await prisma.bookmark.findFirst({
      where: { id: bookmark.id, userId },
      include: {
        passage: true,
        collectionItems: { include: { collection: true } },
        passageReviews: { orderBy: { reviewedAt: 'desc' }, take: 1 },
        annotations: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json({ bookmark: updated });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});



// POST /api/bookmarks/:id/annotations — create a private line-level thought on an owned saved passage
bookmarksRouter.post('/bookmarks/:id/annotations', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const bookmark = await prisma.bookmark.findFirst({ where: { id: req.params.id, userId }, include: { passage: true } });
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }

    const quote = normalizeAnnotationText(req.body?.quote, 600);
    const note = normalizeAnnotationText(req.body?.note, 1200);
    if (!quote || !note) { res.status(400).json({ error: 'quote and note are required strings' }); return; }
    const anchor = validateAnnotationAnchor(bookmark.passage.text, quote, req.body?.startOffset, req.body?.endOffset);
    if ('error' in anchor) { res.status(400).json({ error: anchor.error }); return; }

    const now = new Date();
    const annotation = await prisma.passageAnnotation.create({
      data: {
        id: nanoid(),
        userId,
        bookmarkId: bookmark.id,
        passageId: bookmark.passageId,
        quote,
        startOffset: anchor.start,
        endOffset: anchor.end,
        note,
        createdAt: now,
        updatedAt: now,
      },
    });
    res.json({ annotation });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// PATCH /api/bookmarks/:id/annotations/:annotationId — edit an owned line-level thought
bookmarksRouter.patch('/bookmarks/:id/annotations/:annotationId', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const bookmark = await requireOwnedBookmark(prisma, userId, req.params.id);
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }
    const note = normalizeAnnotationText(req.body?.note, 1200);
    if (!note) { res.status(400).json({ error: 'note is required' }); return; }
    const existing = await prisma.passageAnnotation.findFirst({ where: { id: req.params.annotationId, userId, bookmarkId: bookmark.id } });
    if (!existing) { res.status(404).json({ error: 'Annotation not found' }); return; }
    const annotation = await prisma.passageAnnotation.update({ where: { id: existing.id }, data: { note, updatedAt: new Date() } });
    res.json({ annotation });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/bookmarks/:id/annotations/:annotationId — delete an owned line-level thought
bookmarksRouter.delete('/bookmarks/:id/annotations/:annotationId', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const bookmark = await requireOwnedBookmark(prisma, userId, req.params.id);
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }
    const existing = await prisma.passageAnnotation.findFirst({ where: { id: req.params.annotationId, userId, bookmarkId: bookmark.id } });
    if (!existing) { res.status(404).json({ error: 'Annotation not found' }); return; }
    await prisma.passageAnnotation.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


// POST /api/bookmarks/:id/recall-cards — create a private active-recall cloze card from selected saved-passage text
bookmarksRouter.post('/bookmarks/:id/recall-cards', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const bookmark = await prisma.bookmark.findFirst({ where: { id: req.params.id, userId }, include: { passage: true } });
    if (!bookmark) { res.status(404).json({ error: 'Bookmark not found' }); return; }

    const quote = normalizeAnnotationText(req.body?.quote, 240);
    if (!quote) { res.status(400).json({ error: 'quote is required' }); return; }
    const anchor = validateAnnotationAnchor(bookmark.passage.text, quote, req.body?.startOffset, req.body?.endOffset);
    if ('error' in anchor) { res.status(400).json({ error: anchor.error }); return; }

    const now = new Date();
    const cardId = nanoid();
    const context = buildRecallContext(bookmark.passage.text, anchor.start, anchor.end);
    await prisma.$executeRaw`
      INSERT INTO passage_recall_cards (id, user_id, bookmark_id, passage_id, quote, start_offset, end_offset, context_before, context_after, due_after, box, created_at, updated_at, archived_at)
      VALUES (${cardId}, ${userId}, ${bookmark.id}, ${bookmark.passageId}, ${quote}, ${anchor.start}, ${anchor.end}, ${context.contextBefore}, ${context.contextAfter}, ${now.toISOString()}, ${0}, ${now.toISOString()}, ${now.toISOString()}, ${null})
    `;
    res.json({ recallCard: { id: cardId, userId, bookmarkId: bookmark.id, passageId: bookmark.passageId, quote, startOffset: anchor.start, endOffset: anchor.end, ...context, dueAfter: now.toISOString(), box: 0, passage: bookmark.passage } });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/bookmarks/recall-cards — due private cloze cards for active Recall Practice
bookmarksRouter.get('/bookmarks/recall-cards', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const now = new Date();
    const rows = await prisma.$queryRaw<Array<{
      id: string; bookmark_id: string; passage_id: string; quote: string; start_offset: number; end_offset: number; context_before: string; context_after: string; due_after: string; box: number | null; created_at: string;
      text: string; book_title: string; author: string; chapter: string | null; tags: string; language: string;
    }>>`
      SELECT c.id, c.bookmark_id, c.passage_id, c.quote, c.start_offset, c.end_offset, c.context_before, c.context_after, c.due_after, c.box, c.created_at,
             p.text, p.book_title, p.author, p.chapter, p.tags, p.language
      FROM passage_recall_cards c
      JOIN bookmarks b ON b.id = c.bookmark_id AND b.user_id = c.user_id
      JOIN passages p ON p.id = c.passage_id
      WHERE c.user_id = ${userId} AND c.archived_at IS NULL AND c.due_after <= ${now.toISOString()}
      ORDER BY c.due_after ASC, c.created_at ASC
      LIMIT 8
    `;
    const cards = rows.map(row => ({
      id: row.id,
      bookmarkId: row.bookmark_id,
      passageId: row.passage_id,
      quote: row.quote,
      startOffset: Number(row.start_offset),
      endOffset: Number(row.end_offset),
      contextBefore: row.context_before,
      contextAfter: row.context_after,
      dueAfter: row.due_after,
      box: row.box,
      passage: { id: row.passage_id, text: row.text, bookTitle: row.book_title, author: row.author, chapter: row.chapter ?? undefined, tags: row.tags, language: row.language },
    }));
    res.json({ cards, generatedFor: now.toISOString().slice(0, 10) });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bookmarks/recall-cards/:cardId/review — grade private active recall and schedule next due date
bookmarksRouter.post('/bookmarks/recall-cards/:cardId/review', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensurePassageReviewTable(prisma);
    const userId = claims.sub as string;
    const action = normalizeRecallReviewAction(req.body?.action);
    const cards = await prisma.$queryRaw<Array<{ id: string; box: number | null }>>`
      SELECT id, box FROM passage_recall_cards WHERE id = ${req.params.cardId} AND user_id = ${userId} AND archived_at IS NULL LIMIT 1
    `;
    const card = cards[0];
    if (!card) { res.status(404).json({ error: 'Recall card not found' }); return; }
    const now = new Date();
    const schedule = computeRecallReviewSchedule(card.box, action, now);
    await prisma.$executeRaw`
      UPDATE passage_recall_cards
      SET due_after = ${schedule.dueAfter.toISOString()}, box = ${schedule.box}, updated_at = ${now.toISOString()}
      WHERE id = ${card.id} AND user_id = ${userId}
    `;
    const reviewId = nanoid();
    await prisma.$executeRaw`
      INSERT INTO passage_recall_reviews (id, user_id, recall_card_id, action, reviewed_at, due_after, box)
      VALUES (${reviewId}, ${userId}, ${card.id}, ${action}, ${now.toISOString()}, ${schedule.dueAfter.toISOString()}, ${schedule.box})
    `;
    res.json({ review: { id: reviewId, recallCardId: card.id, action, reviewedAt: now.toISOString(), dueAfter: schedule.dueAfter.toISOString(), box: schedule.box, intervalDays: schedule.intervalDays } });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// DELETE /api/bookmarks/:id
bookmarksRouter.delete('/bookmarks/:id', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    await ensureBookmarkNotesColumn(prisma);
    const bookmark = await requireOwnedBookmark(prisma, claims.sub as string, req.params.id);
    if (bookmark) {
      await prisma.bookmarkCollectionItem.deleteMany({ where: { bookmarkId: bookmark.id } });
      await prisma.bookmark.delete({ where: { id: bookmark.id } });
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
