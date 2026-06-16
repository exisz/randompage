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
const READING_PATH_DAYS = 7;

type ReadingPathGoal = {
  id: string;
  label: string;
  tags: string[];
};

const READING_PATH_GOALS: ReadingPathGoal[] = [
  { id: 'reflective-philosophy', label: 'Reflective philosophy', tags: ['philosophy', 'philosophical-fiction', 'morality', 'human-nature', 'contemplative'] },
  { id: 'inner-life-psychology', label: 'Inner life & psychology', tags: ['psychology', 'self-cultivation', 'relationships', 'love', 'suffering'] },
  { id: 'history-society', label: 'History & society', tags: ['history', 'power', 'critique', 'social-interaction', 'freedom'] },
  { id: 'literary-classics', label: 'Literary classics', tags: ['literature', 'fiction', 'symbolism', 'adventure', 'nature'] },
  { id: 'mystery-tension', label: 'Mystery & tension', tags: ['mystery', 'investigation', 'tense', 'dark', 'deception'] },
];

type ReadingPathRow = {
  id: string;
  user_id: string;
  topic: string;
  goal_id: string | null;
  passage_ids: string;
  started_at: number | string;
};

type DailyQueueStrategy =
  | 'fresh_unread_avoid_free'
  | 'fresh_unread_with_avoids'
  | 'fallback_read_but_not_recent'
  | 'fallback_any_readable'
  | 'empty_no_readable_passages';

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

function avoidsExcludedPassage(passage: { tags: string }, prefMap: Record<string, number>, avoidTags: string[]) {
  return scorePassageTagsWithAvoidance(passage.tags, prefMap, avoidTags) !== scorePassageTagsWithAvoidance(passage.tags, prefMap, []);
}

function uniqueByPassageId<T extends { id: string }>(passages: T[]) {
  const seen = new Set<string>();
  return passages.filter((passage) => {
    if (seen.has(passage.id)) return false;
    seen.add(passage.id);
    return true;
  });
}

function chooseDailyQueuePool<T extends { id: string; tags: string }>(options: {
  readablePassages: T[];
  seenIds: Set<string>;
  recentIds: Set<string>;
  prefMap: Record<string, number>;
  avoidTags: string[];
  limit: number;
}): { pool: T[]; strategy: DailyQueueStrategy; freshOnly: boolean; fallbackUsed: boolean; emptyReason: string | null } {
  const { readablePassages, seenIds, recentIds, prefMap, avoidTags, limit } = options;
  if (readablePassages.length === 0) {
    return {
      pool: [],
      strategy: 'empty_no_readable_passages',
      freshOnly: false,
      fallbackUsed: false,
      emptyReason: 'No readable RandomPage book passages are currently available after content safety filters.',
    };
  }

  const freshCandidates = readablePassages.filter((passage) => !seenIds.has(passage.id));
  const freshAvoidFree = freshCandidates.filter((passage) => !avoidsExcludedPassage(passage, prefMap, avoidTags));
  if (freshAvoidFree.length >= Math.min(limit, readablePassages.length)) {
    return { pool: freshAvoidFree, strategy: 'fresh_unread_avoid_free', freshOnly: true, fallbackUsed: false, emptyReason: null };
  }
  if (freshCandidates.length >= Math.min(limit, readablePassages.length)) {
    return { pool: freshCandidates, strategy: 'fresh_unread_with_avoids', freshOnly: true, fallbackUsed: false, emptyReason: null };
  }

  const notRecent = readablePassages.filter((passage) => !recentIds.has(passage.id));
  if (notRecent.length > 0) {
    return {
      pool: uniqueByPassageId([...freshAvoidFree, ...freshCandidates, ...notRecent]),
      strategy: 'fallback_read_but_not_recent',
      freshOnly: false,
      fallbackUsed: true,
      emptyReason: null,
    };
  }

  return {
    pool: uniqueByPassageId([...freshAvoidFree, ...freshCandidates, ...readablePassages]),
    strategy: 'fallback_any_readable',
    freshOnly: false,
    fallbackUsed: true,
    emptyReason: null,
  };
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


type ReadingChallenge = {
  id: string;
  label: string;
  description: string;
  count: number;
  target: number;
  unit: string;
  complete: boolean;
  href?: string;
  emptyHint: string;
};

function clampProgress(count: number, target: number) {
  return Math.min(target, Math.max(0, count));
}

function challengeProgress(count: number, target: number) {
  return Math.round((clampProgress(count, target) / target) * 100);
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeBookSourceQuery(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 180) : '';
}

function topPositivePreferenceTag(prefs: Array<{ tag: string; weight: number }>) {
  return prefs
    .filter((pref) => !pref.tag.startsWith('avoid:') && pref.weight > 0)
    .sort((a, b) => b.weight - a.weight)[0]?.tag ?? null;
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




async function ensureReadingPathsTable(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reading_paths (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      goal_id TEXT,
      passage_ids TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_days TEXT NOT NULL DEFAULT '[]',
      skipped_days TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS reading_paths_user_started_idx ON reading_paths(user_id, started_at)');
}

function normalizePathTopic(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function startedAtMs(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric < 10_000_000_000 ? numeric * 1000 : Date.parse(String(value));
}

function currentReadingPathDay(startedAt: number | string, now = new Date()) {
  const started = startedAtMs(startedAt);
  if (!Number.isFinite(started)) return 1;
  const elapsed = Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(new Date(started)).getTime()) / 86_400_000);
  return Math.min(READING_PATH_DAYS, Math.max(1, elapsed + 1));
}

function scoreReadingPathCandidate(
  passage: { id: string; bookTitle: string; author: string; tags: string },
  goal: ReadingPathGoal | null,
  topic: string,
  prefMap: Record<string, number>,
  seed: string,
) {
  const tags = parsePassageTags(passage.tags).map((tag) => tag.toLowerCase());
  const haystack = `${passage.bookTitle} ${passage.author} ${tags.join(' ')}`.toLowerCase();
  const topicTerms = topic.split(/\s+/).filter((term) => term.length > 2);
  const topicScore = topicTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 4 : 0), 0);
  const goalScore = goal ? goal.tags.reduce((sum, tag) => sum + (tags.includes(tag) ? 5 : 0), 0) : 0;
  const prefScore = scorePassageTagsWithAvoidance(passage.tags, prefMap, []);
  return topicScore + goalScore + prefScore + hashUnit(`${seed}:${passage.id}`);
}

async function buildReadingPathPayload(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  row: ReadingPathRow,
  now = new Date(),
) {
  const passageIds = JSON.parse(row.passage_ids) as string[];
  const passages = await prisma.passage.findMany({ where: { id: { in: passageIds } } });
  const byId = new Map(passages.map((passage) => [passage.id, passage]));
  const queue = passageIds
    .map((id, index) => {
      const passage = byId.get(id);
      if (!passage) return null;
      const tags = parsePassageTags(passage.tags).map((tag) => tag.toLowerCase());
      const topicTerms = row.topic.split(/\s+/).filter((term) => term.length > 2);
      const matched = topicTerms.filter((term) => `${passage.bookTitle} ${passage.author} ${tags.join(' ')}`.toLowerCase().includes(term));
      return {
        day: index + 1,
        passage,
        reason: matched.length > 0 ? `Matched ${matched.slice(0, 2).join(' + ')} for ${row.topic}.` : `Sequenced from existing RandomPage passages for ${row.topic}.`,
      };
    })
    .filter(Boolean);
  const currentDay = currentReadingPathDay(row.started_at, now);
  const current = queue.find((item) => item?.day === currentDay) ?? queue[0] ?? null;
  if (current?.passage?.id) {
    await recordInteraction(prisma, userId, current.passage.id, 'view', 'discover');
  }
  return {
    id: row.id,
    topic: row.topic,
    goalId: row.goal_id,
    startedAt: row.started_at,
    currentDay,
    totalDays: READING_PATH_DAYS,
    current,
    upcoming: queue.filter((item) => item && item.day > currentDay),
    queue,
  };
}

// GET /api/reading-path — active 7-day goal path for the signed-in reader.
passagesRouter.get('/reading-path', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const userId = claims.sub as string;
    await ensureReadingPathsTable(prisma);
    const rows = await prisma.$queryRaw<ReadingPathRow[]>`
      SELECT id, user_id, topic, goal_id, passage_ids, started_at
      FROM reading_paths
      WHERE user_id = ${userId}
      ORDER BY started_at DESC
      LIMIT 1
    `;
    if (!rows[0]) {
      res.json({ path: null, goals: READING_PATH_GOALS });
      return;
    }
    res.json({ path: await buildReadingPathPayload(prisma, userId, rows[0]), goals: READING_PATH_GOALS });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/reading-path/start — generate a lightweight Headway-parity path from existing book passages.
passagesRouter.post('/reading-path/start', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const userId = claims.sub as string;
    const goalId = typeof req.body?.goalId === 'string' ? req.body.goalId : undefined;
    const goal = READING_PATH_GOALS.find((candidate) => candidate.id === goalId) ?? null;
    const topic = normalizePathTopic(req.body?.topic) || goal?.label.toLowerCase() || '';
    if (!goal && !topic) {
      res.status(400).json({ error: 'Choose a reading goal or topic.' });
      return;
    }

    const prisma = getPrisma();
    const now = new Date();
    await ensureReadingPathsTable(prisma);
    await ensureBrowsingEventsTable(prisma);
    await upsertReader(prisma, userId, now);

    const [allPassages, prefs] = await Promise.all([
      prisma.passage.findMany(),
      prisma.userPreference.findMany({ where: { userId } }),
    ]);
    const prefMap = preferenceMapWithoutAvoids(prefs);
    const pool = filterReadablePassages(allPassages);
    const passageIds = pool
      .map((passage) => ({ passage, score: scoreReadingPathCandidate(passage, goal, topic, prefMap, `${userId}:${topic}`) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, READING_PATH_DAYS)
      .map(({ passage }) => passage.id);

    if (passageIds.length < READING_PATH_DAYS) {
      res.status(404).json({ error: 'Not enough existing RandomPage passages to build a 7-day path.' });
      return;
    }

    const row: ReadingPathRow = {
      id: nanoid(),
      user_id: userId,
      topic,
      goal_id: goal?.id ?? null,
      passage_ids: JSON.stringify(passageIds),
      started_at: epochSeconds(now),
    };
    await prisma.$executeRaw`
      INSERT INTO reading_paths (id, user_id, topic, goal_id, passage_ids, started_at, completed_days, skipped_days)
      VALUES (${row.id}, ${row.user_id}, ${row.topic}, ${row.goal_id}, ${row.passage_ids}, ${row.started_at}, ${'[]'}, ${'[]'})
    `;
    res.json({ path: await buildReadingPathPayload(prisma, userId, row), goals: READING_PATH_GOALS });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
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
    const recentHistoryIds = historyEvents.slice(0, 30).map((event) => event.passageId);
    const recentPushIds = pushHistory.slice(0, 30).map((delivery) => delivery.passageId);
    const seenIds = new Set([
      ...historyEvents.map((event) => event.passageId),
      ...pushHistory.map((delivery) => delivery.passageId),
    ]);
    const recentIds = new Set([...recentHistoryIds, ...recentPushIds]);
    const { avoidTags } = splitPreferenceControls(prefs);
    const prefMap = preferenceMapWithoutAvoids(prefs);
    const poolChoice = chooseDailyQueuePool({ readablePassages, seenIds, recentIds, prefMap, avoidTags, limit });

    const queue = poolChoice.pool
      .map((passage) => ({
        passage,
        queueScore: scoreDailyQueueCandidate(passage, prefMap, avoidTags, seed),
      }))
      .sort((a, b) => b.queueScore - a.queueScore)
      .slice(0, Math.min(limit, readablePassages.length))
      .map(({ passage }, index) => ({
        ...passage,
        queuePosition: index + 1,
        whyPersonalized: explainRecommendation(passage, prefMap),
      }));

    const emptyReason = queue.length === 0
      ? poolChoice.emptyReason ?? 'No usable daily queue passages could be selected from the existing RandomPage library.'
      : null;

    res.json({
      queue,
      generatedFor: today,
      requested: limit,
      freshOnly: poolChoice.freshOnly,
      fallbackUsed: poolChoice.fallbackUsed,
      strategy: poolChoice.strategy,
      emptyReason,
      counts: {
        totalPassages: allPassages.length,
        readablePassages: readablePassages.length,
        seenPassages: seenIds.size,
        recentPassages: recentIds.size,
        poolPassages: poolChoice.pool.length,
      },
    });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/reading/challenges
// Lightweight achievements are derived from existing RandomPage event tables.
passagesRouter.get('/reading/challenges', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    await ensureBrowsingEventsTable(prisma);
    await ensureReadingPathsTable(prisma);

    const userId = claims.sub as string;
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const weekStart = addUtcDays(todayStart, -6);

    const [todayViews, weeklyReviews, pushInboxToday, unreadPushCount, latestPathRows, prefs] = await Promise.all([
      prisma.browsingEvent.findMany({
        where: { userId, action: 'view', createdAt: { gte: todayStart } },
        include: { passage: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.passageReview.count({
        where: { userId, action: 'reviewed', reviewedAt: { gte: weekStart } },
      }),
      prisma.browsingEvent.count({
        where: { userId, action: 'view', source: 'push_inbox', createdAt: { gte: todayStart } },
      }),
      prisma.pushHistory.count({ where: { userId, readAt: null } }),
      prisma.$queryRaw<ReadingPathRow[]>`
        SELECT id, user_id, topic, goal_id, passage_ids, started_at
        FROM reading_paths
        WHERE user_id = ${userId}
        ORDER BY started_at DESC
        LIMIT 1
      `,
      prisma.userPreference.findMany({ where: { userId }, select: { tag: true, weight: true } }),
    ]);

    const latestPath = latestPathRows[0] ?? null;
    const pathPassageIds = latestPath ? parseJsonArray(latestPath.passage_ids) : [];
    const viewedPathIds = new Set(todayViews
      .filter((event) => pathPassageIds.includes(event.passageId))
      .map((event) => event.passageId));
    const favoriteTag = topPositivePreferenceTag(prefs);
    const favoriteTopicViews = favoriteTag
      ? todayViews.filter((event) => parsePassageTags(event.passage.tags).some((tag) => tag.toLowerCase() === favoriteTag.toLowerCase())).length
      : 0;

    const challenges: ReadingChallenge[] = [
      {
        id: 'daily-3-pages',
        label: 'Daily 3 pages',
        description: 'Read three existing RandomPage book passages today.',
        count: clampProgress(todayViews.length, 3),
        target: 3,
        unit: 'pages',
        complete: todayViews.length >= 3,
        href: '/discover',
        emptyHint: 'Open Discover and read or listen to a passage to start today’s count.',
      },
      {
        id: 'weekly-saved-review',
        label: 'Weekly saved review',
        description: 'Review three saved passages this week.',
        count: clampProgress(weeklyReviews, 3),
        target: 3,
        unit: 'reviews',
        complete: weeklyReviews >= 3,
        href: '/bookmarks',
        emptyHint: 'Save passages, then use Daily Review or Recall Cards from your shelf.',
      },
      {
        id: 'path-progress',
        label: '7-day path progress',
        description: latestPath ? `Read pages from your ${latestPath.topic} path.` : 'Start a goal-based 7-day path from existing passages.',
        count: clampProgress(viewedPathIds.size, 7),
        target: 7,
        unit: 'path pages',
        complete: viewedPathIds.size >= 7,
        href: '/discover',
        emptyHint: 'Start a 7-day reading path on Discover to unlock path progress.',
      },
      {
        id: 'push-inbox-read',
        label: 'Open pushed page',
        description: unreadPushCount > 0 ? 'Read one waiting pushed passage from your inbox today.' : 'Read a pushed passage when your daily inbox has one waiting.',
        count: clampProgress(pushInboxToday, 1),
        target: 1,
        unit: 'push read',
        complete: pushInboxToday >= 1,
        href: '/history?tab=push',
        emptyHint: unreadPushCount > 0 ? `${unreadPushCount} unread pushed passage${unreadPushCount === 1 ? '' : 's'} waiting in History.` : 'No unread pushed pages right now; tomorrow’s push will count here.',
      },
      {
        id: 'favorite-topic',
        label: favoriteTag ? `Explore ${favoriteTag}` : 'Explore a favorite topic',
        description: favoriteTag ? `Read one passage matching your ${favoriteTag} preference today.` : 'Build preferences by reading, saving, or choosing reading goals.',
        count: clampProgress(favoriteTopicViews, 1),
        target: 1,
        unit: 'topic page',
        complete: favoriteTopicViews >= 1,
        href: favoriteTag ? `/discover?tag=${encodeURIComponent(favoriteTag)}` : '/settings',
        emptyHint: favoriteTag ? `Use the ${favoriteTag} Discover chip or personalized queue.` : 'Choose reading goals in Settings to seed a favorite-topic challenge.',
      },
    ];

    res.json({
      generatedFor: utcDayKey(now),
      timezone: 'UTC',
      challenges: challenges.map((challenge) => ({
        ...challenge,
        percent: challengeProgress(challenge.count, challenge.target),
      })),
      summary: {
        complete: challenges.filter((challenge) => challenge.complete).length,
        total: challenges.length,
        unreadPushCount,
        favoriteTag,
      },
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

// GET /api/book-source?title=<bookTitle>&author=<author>
// Lists existing RandomPage passages from the same book/source. Auth is optional:
// signed-in readers get unread-first ordering plus saved/read flags.
passagesRouter.get('/book-source', async (req: Request, res: Response) => {
  try {
    const title = normalizeBookSourceQuery(req.query.title);
    const author = normalizeBookSourceQuery(req.query.author);
    if (!title) {
      res.status(400).json({ error: 'title required' });
      return;
    }

    const prisma = getPrisma();
    let userId: string | null = null;
    try {
      const claims = await verifyBearer(req.header('authorization'));
      userId = claims.sub as string;
      await ensureBrowsingEventsTable(prisma);
    } catch {
      // Public book-source browsing is allowed; personalization flags require auth.
    }

    const sourceWhere = author ? { bookTitle: title, author } : { bookTitle: title };
    const allPassages = await prisma.passage.findMany({ where: sourceWhere });
    const readablePassages = filterReadablePassages(allPassages);
    const passageIds = readablePassages.map((passage) => passage.id);

    const [bookmarkRows, viewedRows] = userId ? await Promise.all([
      prisma.bookmark.findMany({ where: { userId, passageId: { in: passageIds } }, select: { passageId: true } }),
      prisma.browsingEvent.findMany({ where: { userId, action: 'view', passageId: { in: passageIds } }, select: { passageId: true } }),
    ]) : [[], []] as [Array<{ passageId: string }>, Array<{ passageId: string }>];

    const savedIds = new Set(bookmarkRows.map((row) => row.passageId));
    const readIds = new Set(viewedRows.map((row) => row.passageId));
    const passages = readablePassages
      .map((passage) => ({
        ...passage,
        isSaved: savedIds.has(passage.id),
        isRead: readIds.has(passage.id),
      }))
      .sort((a, b) => Number(a.isRead) - Number(b.isRead) || a.id.localeCompare(b.id));

    res.json({
      source: {
        title,
        author: author || readablePassages[0]?.author || '',
        passageCount: passages.length,
        savedCount: userId ? savedIds.size : null,
      },
      passages,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
