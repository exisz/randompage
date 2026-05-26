import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { parsePassageTags, scorePassageTags } from '../lib/passageTags.js';
import { filterReadablePassages, isReadablePassage } from '../lib/passageLengthPolicy.js';

export const passagesRouter = Router();

const VALID_INTERACTION_ACTIONS = new Set(['view', 'skip']);
const VALID_INTERACTION_SOURCES = new Set(['discover', 'push_inbox']);

async function ensureBrowsingEventsTable(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS browsing_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'discover',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS browsing_events_user_created_idx ON browsing_events(user_id, created_at)');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS browsing_events_user_passage_idx ON browsing_events(user_id, passage_id)');
}

async function upsertReader(prisma: ReturnType<typeof getPrisma>, userId: string, now: Date) {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, displayName: 'Reader', createdAt: now },
    update: {},
  });
}

async function updatePreferencesForPassage(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  passageId: string,
  delta: number,
  now: Date,
) {
  const passage = await prisma.passage.findUnique({ where: { id: passageId } });
  if (!passage) return;

  const tags = parsePassageTags(passage.tags);
  for (const tag of tags) {
    const existing = await prisma.userPreference.findFirst({ where: { userId, tag } });
    if (existing) {
      await prisma.userPreference.update({
        where: { id: existing.id },
        data: { weight: Math.max(1, existing.weight + delta), updatedAt: now },
      });
    } else if (delta > 0) {
      await prisma.userPreference.create({
        data: { id: nanoid(), userId, tag, weight: 1 + delta, updatedAt: now },
      });
    }
  }
}


async function markPushHistoryRead(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  passageId: string,
  now: Date,
) {
  const push = await prisma.pushHistory.findFirst({
    where: { userId, passageId, readAt: null },
    orderBy: { sentAt: 'desc' },
  });
  if (!push) return;
  await prisma.pushHistory.update({
    where: { id: push.id },
    data: { readAt: now },
  });
}

async function recordInteraction(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  passageId: string | undefined,
  action: string,
  source = 'discover',
) {
  if (!passageId || !VALID_INTERACTION_ACTIONS.has(action)) return;
  const safeSource = VALID_INTERACTION_SOURCES.has(source) ? source : 'discover';
  const now = new Date();
  await ensureBrowsingEventsTable(prisma);
  await upsertReader(prisma, userId, now);
  await prisma.browsingEvent.create({
    data: { id: nanoid(), userId, passageId, action, source: safeSource, createdAt: now },
  });
  await updatePreferencesForPassage(prisma, userId, passageId, action === 'skip' ? -1 : 1, now);
}

// GET /api/passages/random?preferUnread=1&skipPassageId=<id>
passagesRouter.get('/passages/random', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const preferUnread = req.query.preferUnread === '1';
    const skipPassageId = typeof req.query.skipPassageId === 'string' ? req.query.skipPassageId : undefined;
    let userId: string | null = null;

    // Try to get user (optional auth)
    try {
      const claims = await verifyBearer(req.header('authorization'));
      userId = claims.sub as string;
    } catch {
      // anonymous
    }

    if (userId && skipPassageId) {
      await recordInteraction(prisma, userId, skipPassageId, 'skip', 'discover');
    }

    // Get passages - use weighted sampling based on user preferences if authed.
    // Runtime filtering keeps legacy quote-sized / overlong / reference-note rows out of
    // Discover and push entry points while repair work can handle the historical corpus.
    const allPassages = await prisma.passage.findMany();
    const readablePassages = filterReadablePassages(allPassages);
    if (readablePassages.length === 0) {
      res.status(404).json({ error: 'No readable passages found' });
      return;
    }

    let passage = null;

    if (userId && preferUnread) {
      // Try to find an unread passage from push history first
      const recentPush = await prisma.pushHistory.findFirst({
        where: { userId, readAt: null },
        orderBy: { sentAt: 'desc' },
        include: { passage: true },
      });
      if (recentPush && isReadablePassage(recentPush.passage)) {
        // Mark it as read
        const now = new Date();
        await prisma.pushHistory.update({
          where: { id: recentPush.id },
          data: { readAt: now },
        });
        await recordInteraction(prisma, userId, recentPush.passageId, 'view', 'push_inbox');
        res.json({ passage: recentPush.passage, fromInbox: true });
        return;
      }
    }

    if (userId) {
      // Weighted random based on user preferences
      const prefs = await prisma.userPreference.findMany({ where: { userId } });
      const prefMap = Object.fromEntries(prefs.map(p => [p.tag, p.weight]));

      // Get all readable passages and do weighted sampling
      const weights = readablePassages.map(p => ({
        passage: p,
        weight: scorePassageTags(p.tags, prefMap),
      }));

      const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const w of weights) {
        rand -= w.weight;
        if (rand <= 0) {
          passage = w.passage;
          break;
        }
      }
      if (!passage) passage = readablePassages[Math.floor(Math.random() * readablePassages.length)];
    } else {
      // Pure random for anonymous, still bounded to readable fragments.
      passage = readablePassages[Math.floor(Math.random() * readablePassages.length)];
    }

    if (userId && passage) {
      await recordInteraction(prisma, userId, passage.id, 'view', 'discover');
    }

    res.json({ passage });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// GET /api/browsing/history
passagesRouter.get('/browsing/history', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBrowsingEventsTable(prisma);
    const history = await prisma.browsingEvent.findMany({
      where: { userId: claims.sub as string },
      include: { passage: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ history });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/passages/:id?source=push
passagesRouter.get('/passages/:id', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const passage = await prisma.passage.findUnique({ where: { id: req.params.id } });
    if (!passage) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Optional auth: a clicked push carries the exact passageId from the service worker.
    // If the reader is signed in, mark that matching delivery read and feed the view
    // into the same personalization loop used by the push inbox. Authentication failures
    // still allow anonymous reads; telemetry write failures must surface instead of being
    // silently swallowed, because push_history.read_at without browsing_events breaks audits.
    let userId: string | null = null;
    try {
      const claims = await verifyBearer(req.header('authorization'));
      userId = claims.sub as string;
    } catch {
      // Anonymous direct passage reads are supported, but personalization is scoped to auth users.
    }
    const source = typeof req.query.source === 'string' ? req.query.source : 'discover';
    if (userId && (source === 'push' || source === 'push_inbox')) {
      const now = new Date();
      await markPushHistoryRead(prisma, userId, passage.id, now);
      await recordInteraction(prisma, userId, passage.id, 'view', 'push_inbox');
    }

    res.json({ passage });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
