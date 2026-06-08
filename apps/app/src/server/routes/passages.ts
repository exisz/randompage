import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { parsePassageTags } from '../lib/passageTags.js';
import { explainRecommendation } from '../lib/recommendationExplanation.js';
import { preferenceMapWithoutAvoids, scorePassageTagsWithAvoidance, splitPreferenceControls } from '../lib/preferenceControls.js';
import { filterReadablePassages, isReadablePassage } from '../lib/passageLengthPolicy.js';

export const passagesRouter = Router();

const VALID_INTERACTION_ACTIONS = new Set(['view', 'skip']);
const VALID_INTERACTION_SOURCES = new Set(['discover', 'push_inbox']);
const DAILY_QUEUE_DEFAULT_LIMIT = 5;
const DAILY_QUEUE_MAX_LIMIT = 5;


function boundedDailyQueueLimit(raw: unknown) {
  if (typeof raw !== 'string') return DAILY_QUEUE_DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DAILY_QUEUE_DEFAULT_LIMIT;
  return Math.min(DAILY_QUEUE_MAX_LIMIT, Math.max(3, parsed));
}

function hashUnit(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function scoreDailyQueueCandidate(
  passage: { id: string; tags: string },
  prefMap: Record<string, number>,
  avoidTags: string[],
  seed: string,
) {
  const preferenceScore = scorePassageTagsWithAvoidance(passage.tags, prefMap, avoidTags);
  const dailyJitter = hashUnit(`${seed}:${passage.id}`);
  return preferenceScore * (1 + dailyJitter * 0.35);
}

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

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

async function upsertReader(prisma: ReturnType<typeof getPrisma>, userId: string, now: Date) {
  // Production legacy users.created_at is INTEGER unix seconds; raw insert avoids
  // Prisma DateTime serializing ISO text into that column for first-time readers.
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO users (id, display_name, created_at)
    VALUES (${userId}, ${'Reader'}, ${epochSeconds(now)})
  `;
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

  const updatedAt = epochSeconds(now);
  const tags = parsePassageTags(passage.tags);
  for (const tag of tags) {
    const existing = await prisma.$queryRaw<Array<{ id: string; weight: number }>>`
      SELECT id, weight FROM user_preferences WHERE user_id = ${userId} AND tag = ${tag} LIMIT 1
    `;
    if (existing[0]) {
      await prisma.$executeRaw`
        UPDATE user_preferences
        SET weight = ${Math.max(1, Number(existing[0].weight) + delta)}, updated_at = ${updatedAt}
        WHERE id = ${existing[0].id}
      `;
    } else if (delta > 0) {
      await prisma.$executeRaw`
        INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
        VALUES (${nanoid()}, ${userId}, ${tag}, ${1 + delta}, ${updatedAt})
      `;
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


function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calculateCurrentStreak(viewDates: Date[], today: Date) {
  const dayKeys = new Set(viewDates.map(utcDayKey));
  let cursor = startOfUtcDay(today);
  let streak = 0;
  while (dayKeys.has(utcDayKey(cursor))) {
    streak += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return streak;
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

// GET /api/passages/tags?limit=12 — top tags for the Discover chip-strip (no auth required)
passagesRouter.get('/passages/tags', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const allPassages = await prisma.passage.findMany({ select: { tags: true } });
    const HIDDEN = new Set(['en', 'zh', 'ja', 'fr', 'de', 'es', 'other']);
    const counts: Record<string, number> = {};
    for (const p of allPassages) {
      for (const tag of parsePassageTags(p.tags)) {
        const t = tag.toLowerCase().trim();
        if (!t || HIDDEN.has(t)) continue;
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === 'string' ? Math.min(20, Math.max(1, Number.parseInt(limitRaw, 10) || 12)) : 12;
    const topTags = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
    res.json({ tags: topTags });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/passages/random?preferUnread=1&skipPassageId=<id>&tag=<tag>
passagesRouter.get('/passages/random', async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const preferUnread = req.query.preferUnread === '1';
    const skipPassageId = typeof req.query.skipPassageId === 'string' ? req.query.skipPassageId : undefined;
    const tagFilter = typeof req.query.tag === 'string' ? req.query.tag.toLowerCase().trim() : undefined;
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

    // Apply tag filter — fall back to full pool if no passages match the selected tag.
    const tagFilteredPassages = tagFilter
      ? (() => {
          const filtered = readablePassages.filter((p) =>
            parsePassageTags(p.tags).some((t) => t.toLowerCase() === tagFilter),
          );
          return filtered.length > 0 ? filtered : readablePassages;
        })()
      : readablePassages;

    let passage = null;

    const prefs = userId ? await prisma.userPreference.findMany({ where: { userId } }) : [];
    const { avoidTags } = splitPreferenceControls(prefs);
    const prefMap = preferenceMapWithoutAvoids(prefs);

    // Skip push inbox when a tag filter is active — respect the user's chosen category.
    if (userId && preferUnread && !tagFilter) {
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
        res.json({
          passage: recentPush.passage,
          fromInbox: true,
          whyPersonalized: explainRecommendation(recentPush.passage, prefMap),
        });
        return;
      }
    }

    if (userId) {
      // Weighted random based on user preferences
      // Use tag-filtered pool for weighted sampling
      const weights = tagFilteredPassages.map(p => ({
        passage: p,
        weight: scorePassageTagsWithAvoidance(p.tags, prefMap, avoidTags),
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
      if (!passage) passage = tagFilteredPassages[Math.floor(Math.random() * tagFilteredPassages.length)];
    } else {
      // Pure random for anonymous, still bounded to readable + tag-filtered pool.
      passage = tagFilteredPassages[Math.floor(Math.random() * tagFilteredPassages.length)];
    }

    if (userId && passage) {
      await recordInteraction(prisma, userId, passage.id, 'view', 'discover');
    }

    res.json({ passage, whyPersonalized: userId && passage ? explainRecommendation(passage, prefMap) : null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});



// GET /api/passages/daily-queue?limit=5
// Returns a small deterministic-per-day recommendation stack for the signed-in reader.
// It is a preview queue only: passage views are recorded when the reader opens a card.
passagesRouter.get('/passages/daily-queue', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBrowsingEventsTable(prisma);

    const userId = claims.sub as string;
    const limit = boundedDailyQueueLimit(req.query.limit);
    const today = utcDayKey(new Date());
    const seed = `${userId}:${today}`;

    const [allPassages, prefs, historyEvents, pushHistory] = await Promise.all([
      prisma.passage.findMany(),
      prisma.userPreference.findMany({ where: { userId } }),
      prisma.browsingEvent.findMany({
        where: { userId, action: 'view' },
        select: { passageId: true },
        orderBy: { createdAt: 'desc' },
        take: 250,
      }),
      prisma.pushHistory.findMany({
        where: { userId },
        select: { passageId: true },
        orderBy: { sentAt: 'desc' },
        take: 250,
      }),
    ]);

    const readablePassages = filterReadablePassages(allPassages);
    const seenIds = new Set([
      ...historyEvents.map((event) => event.passageId),
      ...pushHistory.map((delivery) => delivery.passageId),
    ]);
    const { avoidTags } = splitPreferenceControls(prefs);
    const prefMap = preferenceMapWithoutAvoids(prefs);
    const freshCandidates = readablePassages.filter((passage) => !seenIds.has(passage.id));
    const basePool = freshCandidates.length >= limit ? freshCandidates : readablePassages;
    const avoidFreePool = basePool.filter((passage) => scorePassageTagsWithAvoidance(passage.tags, prefMap, avoidTags) === scorePassageTagsWithAvoidance(passage.tags, prefMap, []));
    const pool = avoidFreePool.length >= limit ? avoidFreePool : basePool;

    const queue = pool
      .map((passage) => ({
        passage,
        queueScore: scoreDailyQueueCandidate(passage, prefMap, avoidTags, seed),
      }))
      .sort((a, b) => b.queueScore - a.queueScore)
      .slice(0, limit)
      .map(({ passage }, index) => ({
        ...passage,
        queuePosition: index + 1,
        whyPersonalized: explainRecommendation(passage, prefMap),
      }));

    res.json({
      queue,
      generatedFor: today,
      requested: limit,
      freshOnly: freshCandidates.length >= limit,
      strategy: 'daily_user_preference_unread_weighted',
    });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/reading/stats
passagesRouter.get('/reading/stats', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBrowsingEventsTable(prisma);

    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const lookbackStart = addUtcDays(todayStart, -90);
    const userId = claims.sub as string;

    const [todayCount, recentViews] = await Promise.all([
      prisma.browsingEvent.count({
        where: {
          userId,
          action: 'view',
          createdAt: { gte: todayStart },
        },
      }),
      prisma.browsingEvent.findMany({
        where: {
          userId,
          action: 'view',
          createdAt: { gte: lookbackStart },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const activeDays = Array.from(new Set(recentViews.map((event) => utcDayKey(event.createdAt)))).sort().reverse();
    res.json({
      todayCount,
      streakDays: calculateCurrentStreak(recentViews.map((event) => event.createdAt), now),
      activeDays,
      timezone: 'UTC',
    });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/browsing/history
passagesRouter.get('/browsing/history', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBrowsingEventsTable(prisma);
    const userId = claims.sub as string;
    const [history, prefs] = await Promise.all([
      prisma.browsingEvent.findMany({
        where: { userId },
        include: { passage: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.userPreference.findMany({ where: { userId } }),
    ]);
    const prefMap = preferenceMapWithoutAvoids(prefs);
    res.json({
      history: history.map((item) => ({
        ...item,
        whyPersonalized: explainRecommendation(item.passage, prefMap),
      })),
    });
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
    } else if (userId && source === 'discover') {
      await recordInteraction(prisma, userId, passage.id, 'view', 'discover');
    }

    const prefs = userId ? await prisma.userPreference.findMany({ where: { userId } }) : [];
    const prefMap = preferenceMapWithoutAvoids(prefs);
    res.json({ passage, whyPersonalized: userId ? explainRecommendation(passage, prefMap) : null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
