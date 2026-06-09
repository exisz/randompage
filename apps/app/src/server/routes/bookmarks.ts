import { Router, type Request, type Response } from 'express';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { nanoid } from 'nanoid';
import { parsePassageTags } from '../lib/passageTags.js';

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

async function ensurePassageReviewTable(prisma: ReturnType<typeof getPrisma>) {
  await ensureBookmarkCollectionTables(prisma);
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
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ bookmarks });
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
    const dueAfter = action === 'reviewed' ? addDays(now, 7) : addDays(now, 1);
    const review = await prisma.passageReview.create({
      data: {
        id: nanoid(),
        userId,
        bookmarkId: bookmark.id,
        passageId: bookmark.passageId,
        action,
        reviewedAt: now,
        dueAfter,
      },
    });
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

    const bookmarkId = nanoid();
    await prisma.$executeRaw`
      INSERT INTO bookmarks (id, user_id, passage_id, created_at)
      VALUES (${bookmarkId}, ${userId}, ${passageId}, ${epochSeconds(now)})
    `;
    res.json({ bookmark: { id: bookmarkId, userId, passageId, createdAt: now.toISOString() } });
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
