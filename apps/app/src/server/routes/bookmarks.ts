import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';
import { parsePassageTags } from '../lib/passageTags.js';
import { computeReviewSchedule, deriveBoxFromHistory, type ReviewAction } from '../lib/spacedReview.js';
import { scoreRecallPassages, type RecallSearchPassageInput } from '../lib/recallSearch.js';

export const bookmarksRouter = Router();

async function ensureBookmarkCollectionTables(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bookmark_collections (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
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
      candidates.set(input.id, {
        ...existing,
        note: existing.note ?? input.note,
        collections,
        sources,
      });
    };

    for (const bookmark of bookmarks) {
      upsertCandidate({
        ...bookmark.passage,
        note: bookmark.note,
        annotations: bookmark.annotations.map(annotation => ({ quote: annotation.quote, note: annotation.note })),
        collections: bookmark.collectionItems.map(item => item.collection.name),
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
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const userId = claims.sub as string;
    const now = new Date();
    await ensureUserRow(prisma, userId);
    const collection = await prisma.bookmarkCollection.create({
      data: { id: nanoid(), userId, name, createdAt: now, updatedAt: now },
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
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const prisma = getPrisma();
    await ensureBookmarkCollectionTables(prisma);
    const userId = claims.sub as string;
    const collection = await requireOwnedCollection(prisma, userId, req.params.id);
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return; }
    const updated = await prisma.bookmarkCollection.update({
      where: { id: collection.id },
      data: { name, updatedAt: new Date() },
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

    const bookmarks = await prisma.bookmark.findMany({
      where: { userId },
      include: {
        passage: true,
        passageReviews: { orderBy: { reviewedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const due = bookmarks
      .filter((bookmark) => {
        const latest = bookmark.passageReviews[0];
        return !latest || latest.dueAfter <= now;
      })
      .slice(0, 3)
      .map((bookmark, index) => ({
        id: bookmark.id,
        bookmarkId: bookmark.id,
        passageId: bookmark.passageId,
        reviewPosition: index + 1,
        lastReviewedAt: bookmark.passageReviews[0]?.reviewedAt ?? null,
        note: bookmark.note ?? null,
        passage: bookmark.passage,
      }));

    res.json({ items: due, generatedFor: now.toISOString().slice(0, 10) });
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
