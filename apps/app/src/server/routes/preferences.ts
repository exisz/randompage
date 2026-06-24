import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { parsePassageTags } from '../lib/passageTags.js';
import { AVOID_TAG_WEIGHT, CONTROL_TAG_PREFIX, avoidPreferenceTag, normalizeAvoidTag, splitPreferenceControls } from '../lib/preferenceControls.js';
import { parseReviewTuning, reviewTuningTag, reviewTuningWeight, type ReviewTuningPreset, type ReviewTuningScope } from '../lib/reviewTuning.js';

export const preferencesRouter = Router();

const GOAL_SEED_WEIGHT = 7;
const DEFAULT_AVOID_TAGS = ['dark', 'tense', 'deception', 'suffering', 'violence'];
const MAX_AVOID_TAGS = 5;
const DAILY_PUSH_HOUR_TAG = `${CONTROL_TAG_PREFIX}daily-push:hour`;
const DAILY_PUSH_TZ_PREFIX = `${CONTROL_TAG_PREFIX}daily-push:tz:`;
const READ_LATER_EMAIL_PREFIX = `${CONTROL_TAG_PREFIX}read-later:email:`;
const READ_LATER_ACTIVE_TAG = `${CONTROL_TAG_PREFIX}read-later:active`;
const READ_LATER_VERIFIED_TAG = `${CONTROL_TAG_PREFIX}read-later:verified`;

const READING_GOALS = [
  {
    id: 'reflective-philosophy',
    label: 'Reflective philosophy',
    tags: ['philosophy', 'philosophical-fiction', 'morality', 'human-nature', 'contemplative'],
  },
  {
    id: 'inner-life-psychology',
    label: 'Inner life & psychology',
    tags: ['psychology', 'self-cultivation', 'relationships', 'love', 'suffering'],
  },
  {
    id: 'history-society',
    label: 'History & society',
    tags: ['history', 'power', 'critique', 'social-interaction', 'freedom'],
  },
  {
    id: 'literary-classics',
    label: 'Literary classics',
    tags: ['literature', 'fiction', 'symbolism', 'adventure', 'nature'],
  },
  {
    id: 'mystery-tension',
    label: 'Mystery & tension',
    tags: ['mystery', 'investigation', 'tense', 'dark', 'deception'],
  },
] as const;

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

async function upsertReader(prisma: ReturnType<typeof getPrisma>, userId: string, now: Date) {
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO users (id, display_name, created_at)
    VALUES (${userId}, ${'Reader'}, ${epochSeconds(now)})
  `;
}

function normalizeGoalIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

async function fetchPreferences(prisma: ReturnType<typeof getPrisma>, userId: string) {
  return prisma.userPreference.findMany({
    where: { userId },
    orderBy: [{ weight: 'desc' }, { tag: 'asc' }],
  });
}

async function fetchAvoidTagOptions(prisma: ReturnType<typeof getPrisma>) {
  const rows = await prisma.passage.findMany({ select: { tags: true } });
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of parsePassageTags(row.tags)) {
      const normalized = normalizeAvoidTag(tag);
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  const preferred = DEFAULT_AVOID_TAGS
    .filter((tag) => (counts.get(tag) ?? 0) > 0)
    .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
  const fallback = Array.from(counts.entries())
    .filter(([tag]) => !DEFAULT_AVOID_TAGS.includes(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  return [...preferred, ...fallback].slice(0, 12);
}

function normalizeAvoidTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(normalizeAvoidTag)
    .filter(Boolean)));
}

function normalizeDailyPushHour(value: unknown) {
  const hour = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function normalizeTimeZone(value: unknown) {
  const timeZone = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

function dailyPushTimeLabel(hour: number, timeZone: string) {
  const date = new Date(Date.UTC(2026, 0, 1, hour, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date) + ` ${timeZone}`;
}

function readLaterDestinationFromPreferences(preferences: Array<{ tag: string; weight: number }>) {
  const emailRow = preferences.find((pref) => pref.tag.startsWith(READ_LATER_EMAIL_PREFIX));
  const email = emailRow ? decodeURIComponent(emailRow.tag.slice(READ_LATER_EMAIL_PREFIX.length)) : '';
  const active = preferences.some((pref) => pref.tag === READ_LATER_ACTIVE_TAG && Number(pref.weight) === 1);
  const verified = preferences.some((pref) => pref.tag === READ_LATER_VERIFIED_TAG && Number(pref.weight) === 1);
  if (!email) return { email: '', active: false, verified: false, configured: false };
  return { email, active, verified, configured: true };
}

function normalizeReadLaterEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function dailyPushScheduleFromPreferences(preferences: Array<{ tag: string; weight: number }>) {
  const hourRow = preferences.find((pref) => pref.tag === DAILY_PUSH_HOUR_TAG);
  const tzRow = preferences.find((pref) => pref.tag.startsWith(DAILY_PUSH_TZ_PREFIX));
  const hour = hourRow ? normalizeDailyPushHour(hourRow.weight) : null;
  const timeZone = tzRow ? decodeURIComponent(tzRow.tag.slice(DAILY_PUSH_TZ_PREFIX.length)) : null;
  if (hour === null || !timeZone) return null;
  return {
    hour,
    timeZone,
    windowHours: 1,
    label: dailyPushTimeLabel(hour, timeZone),
  };
}


// GET /api/preferences
preferencesRouter.get('/preferences', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const prefs = await fetchPreferences(prisma, claims.sub as string);
    const { positivePreferences, avoidTags: selectedAvoidTags } = splitPreferenceControls(prefs);
    const avoidTags = await fetchAvoidTagOptions(prisma);
    const dailyPushSchedule = dailyPushScheduleFromPreferences(prefs);
    const readLaterDestination = readLaterDestinationFromPreferences(prefs);
    const reviewTuning = parseReviewTuning(prefs);
    res.json({ preferences: positivePreferences, readingGoals: READING_GOALS, avoidTags, selectedAvoidTags, dailyPushSchedule, readLaterDestination, reviewTuning });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/preferences/goals
// Seeds existing user_preferences rows from the Settings reading-goal onboarding card.
preferencesRouter.post('/preferences/goals', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const selectedGoalIds = normalizeGoalIds(req.body?.goalIds);
    const selectedGoals = READING_GOALS.filter((goal) => selectedGoalIds.includes(goal.id));
    const selectedSet = new Set(selectedGoals.map((goal) => goal.id));

    if (selectedGoals.length < 1 || selectedGoals.length > 3 || selectedSet.size !== selectedGoalIds.length) {
      res.status(400).json({ error: 'Choose 1–3 reading goals.' });
      return;
    }

    const userId = claims.sub as string;
    const prisma = getPrisma();
    const now = new Date();
    const updatedAt = epochSeconds(now);
    await upsertReader(prisma, userId, now);

    const tags = Array.from(new Set(selectedGoals.flatMap((goal) => goal.tags)));
    for (const tag of tags) {
      const existing = await prisma.$queryRaw<Array<{ id: string; weight: number }>>`
        SELECT id, weight FROM user_preferences WHERE user_id = ${userId} AND tag = ${tag} LIMIT 1
      `;
      if (existing[0]) {
        await prisma.$executeRaw`
          UPDATE user_preferences
          SET weight = ${Math.max(GOAL_SEED_WEIGHT, Number(existing[0].weight) || 1)}, updated_at = ${updatedAt}
          WHERE id = ${existing[0].id}
        `;
      } else {
        await prisma.$executeRaw`
          INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
          VALUES (${nanoid()}, ${userId}, ${tag}, ${GOAL_SEED_WEIGHT}, ${updatedAt})
        `;
      }
    }

    const prefs = await fetchPreferences(prisma, userId);
    const { positivePreferences, avoidTags: selectedAvoidTags } = splitPreferenceControls(prefs);
    const avoidTags = await fetchAvoidTagOptions(prisma);
    res.json({ preferences: positivePreferences, selectedGoals, seededTags: tags, avoidTags, selectedAvoidTags });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/preferences/avoid-tags
// Stores lightweight negative preference controls in existing user_preferences rows.
preferencesRouter.post('/preferences/avoid-tags', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const selectedAvoidTags = normalizeAvoidTags(req.body?.avoidTags);
    if (selectedAvoidTags.length > MAX_AVOID_TAGS) {
      res.status(400).json({ error: `Choose up to ${MAX_AVOID_TAGS} avoid tags.` });
      return;
    }

    const userId = claims.sub as string;
    const prisma = getPrisma();
    const now = new Date();
    const updatedAt = epochSeconds(now);
    await upsertReader(prisma, userId, now);

    const optionRows = await fetchAvoidTagOptions(prisma);
    const validTags = new Set(optionRows.map((option) => option.tag));
    const invalid = selectedAvoidTags.filter((tag) => !validTags.has(tag));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown avoid tags: ${invalid.join(', ')}` });
      return;
    }

    await prisma.$executeRaw`
      DELETE FROM user_preferences
      WHERE user_id = ${userId} AND tag LIKE 'avoid:%'
    `;

    for (const tag of selectedAvoidTags) {
      await prisma.$executeRaw`
        INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
        VALUES (${nanoid()}, ${userId}, ${avoidPreferenceTag(tag)}, ${AVOID_TAG_WEIGHT}, ${updatedAt})
      `;
    }

    const prefs = await fetchPreferences(prisma, userId);
    const { positivePreferences, avoidTags: savedAvoidTags } = splitPreferenceControls(prefs);
    const avoidTags = await fetchAvoidTagOptions(prisma);
    res.json({ preferences: positivePreferences, avoidTags, selectedAvoidTags: savedAvoidTags });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});


function normalizeReviewTuningScope(value: unknown): ReviewTuningScope | null {
  return value === 'global' || value === 'source' || value === 'tag' ? value : null;
}

function normalizeReviewTuningPreset(value: unknown): ReviewTuningPreset | null {
  return value === 'pause' || value === 'less' || value === 'normal' || value === 'more' ? value : null;
}

function normalizeReviewTuningValue(scope: ReviewTuningScope, value: unknown) {
  if (scope === 'global') return '';
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 220) return null;
  return scope === 'tag' ? normalizeAvoidTag(text) : text;
}

// POST /api/preferences/review-tuning
// Stores per-user Daily Review frequency tuning in existing user_preferences control rows.
preferencesRouter.post('/preferences/review-tuning', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const scope = normalizeReviewTuningScope(req.body?.scope);
    const preset = normalizeReviewTuningPreset(req.body?.preset);
    if (!scope || !preset) {
      res.status(400).json({ error: 'Choose a valid review tuning scope and preset.' });
      return;
    }
    const value = normalizeReviewTuningValue(scope, req.body?.value);
    if (value === null) {
      res.status(400).json({ error: 'Choose a valid book/source or tag.' });
      return;
    }

    const userId = claims.sub as string;
    const prisma = getPrisma();
    const now = new Date();
    const updatedAt = epochSeconds(now);
    await upsertReader(prisma, userId, now);

    const tag = reviewTuningTag(scope, value);
    await prisma.$executeRaw`
      DELETE FROM user_preferences
      WHERE user_id = ${userId} AND tag = ${tag}
    `;
    if (preset !== 'normal') {
      await prisma.$executeRaw`
        INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
        VALUES (${nanoid()}, ${userId}, ${tag}, ${reviewTuningWeight(preset)}, ${updatedAt})
      `;
    }

    const prefs = await fetchPreferences(prisma, userId);
    res.json({ reviewTuning: parseReviewTuning(prefs) });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/preferences/read-later-destination
// Stores the user's private Kindle/read-later destination in existing user_preferences control rows.
preferencesRouter.post('/preferences/read-later-destination', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const clear = Boolean(req.body?.clear);
    const email = normalizeReadLaterEmail(req.body?.email);
    const active = req.body?.active !== false;
    const verified = Boolean(req.body?.verified);
    if (!clear && !email) {
      res.status(400).json({ error: 'Enter a valid Kindle/read-later destination email.' });
      return;
    }

    const userId = claims.sub as string;
    const prisma = getPrisma();
    const now = new Date();
    const updatedAt = epochSeconds(now);
    await upsertReader(prisma, userId, now);

    await prisma.$executeRaw`
      DELETE FROM user_preferences
      WHERE user_id = ${userId}
        AND (tag LIKE ${`${READ_LATER_EMAIL_PREFIX}%`} OR tag = ${READ_LATER_ACTIVE_TAG} OR tag = ${READ_LATER_VERIFIED_TAG})
    `;

    if (!clear && email) {
      await prisma.$executeRaw`
        INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
        VALUES (${nanoid()}, ${userId}, ${`${READ_LATER_EMAIL_PREFIX}${encodeURIComponent(email)}`}, ${1}, ${updatedAt})
      `;
      if (active) {
        await prisma.$executeRaw`
          INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
          VALUES (${nanoid()}, ${userId}, ${READ_LATER_ACTIVE_TAG}, ${1}, ${updatedAt})
        `;
      }
      if (verified) {
        await prisma.$executeRaw`
          INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
          VALUES (${nanoid()}, ${userId}, ${READ_LATER_VERIFIED_TAG}, ${1}, ${updatedAt})
        `;
      }
    }

    const prefs = await fetchPreferences(prisma, userId);
    res.json({ readLaterDestination: readLaterDestinationFromPreferences(prefs) });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/preferences/daily-push-schedule
// Stores the user's preferred daily delivery hour in existing user_preferences control rows.
preferencesRouter.post('/preferences/daily-push-schedule', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const hour = normalizeDailyPushHour(req.body?.hour);
    const timeZone = normalizeTimeZone(req.body?.timeZone);
    if (hour === null || !timeZone) {
      res.status(400).json({ error: 'Choose a valid daily passage hour and time zone.' });
      return;
    }

    const userId = claims.sub as string;
    const prisma = getPrisma();
    const now = new Date();
    const updatedAt = epochSeconds(now);
    await upsertReader(prisma, userId, now);

    await prisma.$executeRaw`
      DELETE FROM user_preferences
      WHERE user_id = ${userId}
        AND (tag = ${DAILY_PUSH_HOUR_TAG} OR tag LIKE ${`${DAILY_PUSH_TZ_PREFIX}%`})
    `;
    await prisma.$executeRaw`
      INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
      VALUES (${nanoid()}, ${userId}, ${DAILY_PUSH_HOUR_TAG}, ${hour}, ${updatedAt})
    `;
    await prisma.$executeRaw`
      INSERT INTO user_preferences (id, user_id, tag, weight, updated_at)
      VALUES (${nanoid()}, ${userId}, ${`${DAILY_PUSH_TZ_PREFIX}${encodeURIComponent(timeZone)}`}, ${1}, ${updatedAt})
    `;

    const prefs = await fetchPreferences(prisma, userId);
    res.json({ dailyPushSchedule: dailyPushScheduleFromPreferences(prefs) });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

