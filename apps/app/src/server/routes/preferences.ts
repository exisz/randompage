import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { verifyBearer } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

export const preferencesRouter = Router();

const GOAL_SEED_WEIGHT = 7;

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

// GET /api/preferences
preferencesRouter.get('/preferences', async (req: Request, res: Response) => {
  try {
    const claims = await verifyBearer(req.header('authorization'));
    const prisma = getPrisma();
    const prefs = await fetchPreferences(prisma, claims.sub as string);
    res.json({ preferences: prefs, readingGoals: READING_GOALS });
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
    res.json({ preferences: prefs, selectedGoals, seededTags: tags });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
