import { db } from '@/db';
import { userPreferences, bookmarks, pushHistory, passages } from '@/db/schema';
import { eq, sql, and, notInArray } from 'drizzle-orm';

/**
 * Rebuild user preference weights from their bookmarks and push history (read items).
 * Each tag from bookmarked passages gets +3 weight.
 * Each tag from read push items gets +1 weight.
 * This is L1 recommendation: tag frequency → weighted sampling.
 */
export async function rebuildUserPreferences(userId: string): Promise<void> {
  // Get bookmarked passage tags
  const userBookmarks = await db
    .select({ tags: passages.tags })
    .from(bookmarks)
    .innerJoin(passages, eq(bookmarks.passageId, passages.id))
    .where(eq(bookmarks.userId, userId));

  // Get read push history passage tags
  const readPushes = await db
    .select({ tags: passages.tags })
    .from(pushHistory)
    .innerJoin(passages, eq(pushHistory.passageId, passages.id))
    .where(and(eq(pushHistory.userId, userId), sql`${pushHistory.readAt} IS NOT NULL`));

  // Count tag weights
  const tagWeights: Record<string, number> = {};

  for (const row of userBookmarks) {
    const tags: string[] = JSON.parse(row.tags);
    for (const tag of tags) {
      tagWeights[tag] = (tagWeights[tag] || 0) + 3;
    }
  }

  for (const row of readPushes) {
    const tags: string[] = JSON.parse(row.tags);
    for (const tag of tags) {
      tagWeights[tag] = (tagWeights[tag] || 0) + 1;
    }
  }

  // Clear old preferences
  await db.delete(userPreferences).where(eq(userPreferences.userId, userId));

  // Insert new preferences
  const now = new Date();
  const entries = Object.entries(tagWeights);
  if (entries.length > 0) {
    await db.insert(userPreferences).values(
      entries.map(([tag, weight]) => ({
        id: crypto.randomUUID(),
        userId,
        tag,
        weight,
        updatedAt: now,
      }))
    );
  }
}

/**
 * Get a weighted-random passage for a user based on their preferences.
 * Falls back to pure random for cold-start users (no preferences).
 * Excludes passages from browsing history IDs if provided.
 */
export async function getWeightedPassage(
  userId: string,
  excludeIds?: string[]
): Promise<{
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter: string | null;
  tags: string;
  language: string;
} | null> {
  // Get user preferences
  const prefs = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  // Cold start: no preferences → pure random (L0)
  if (prefs.length === 0) {
    const query = excludeIds && excludeIds.length > 0
      ? db.select().from(passages).where(notInArray(passages.id, excludeIds)).orderBy(sql`RANDOM()`).limit(1)
      : db.select().from(passages).orderBy(sql`RANDOM()`).limit(1);
    const [p] = await query;
    return p || null;
  }

  // L1: Tag-weighted sampling
  // Strategy: fetch a pool of candidates, score them, weighted random pick
  const poolSize = 50;
  const query = excludeIds && excludeIds.length > 0
    ? db.select().from(passages).where(notInArray(passages.id, excludeIds)).orderBy(sql`RANDOM()`).limit(poolSize)
    : db.select().from(passages).orderBy(sql`RANDOM()`).limit(poolSize);
  const pool = await query;

  if (pool.length === 0) return null;

  // Build tag → weight map
  const prefMap: Record<string, number> = {};
  for (const p of prefs) {
    prefMap[p.tag] = p.weight;
  }

  // Score each passage
  const scored = pool.map((p) => {
    const tags: string[] = JSON.parse(p.tags);
    let score = 1; // base score so every passage has a chance
    for (const tag of tags) {
      if (prefMap[tag]) {
        score += prefMap[tag];
      }
    }
    return { passage: p, score };
  });

  // Weighted random selection
  const totalScore = scored.reduce((sum, s) => sum + s.score, 0);
  let rand = Math.random() * totalScore;
  for (const s of scored) {
    rand -= s.score;
    if (rand <= 0) return s.passage;
  }

  return scored[scored.length - 1].passage;
}
