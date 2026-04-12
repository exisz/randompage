import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions, pushHistory } from '@/db/schema';
import { sendPush } from '@/lib/push';
import { eq } from 'drizzle-orm';
import { getWeightedPassage } from '@/lib/preferences';

export const dynamic = 'force-dynamic';

// GET /api/cron/daily-push — Vercel Cron triggers this daily
// Protected by CRON_SECRET (Vercel sets Authorization header automatically)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allSubs = await db.select().from(pushSubscriptions);
  if (allSubs.length === 0) {
    return NextResponse.json({ message: 'No subscribers' });
  }

  // Group subscriptions by user
  const userSubs: Record<string, typeof allSubs> = {};
  for (const sub of allSubs) {
    if (!userSubs[sub.userId]) userSubs[sub.userId] = [];
    userSubs[sub.userId].push(sub);
  }

  let sent = 0;
  let failed = 0;
  const results: { userId: string; passageId: string }[] = [];

  for (const [userId, subs] of Object.entries(userSubs)) {
    // Get already-pushed passage IDs for this user to avoid repeats
    const history = await db
      .select({ passageId: pushHistory.passageId })
      .from(pushHistory)
      .where(eq(pushHistory.userId, userId));
    const excludeIds = history.map((h) => h.passageId);

    // Get a personalized passage for this user (L1 weighted)
    const passage = await getWeightedPassage(userId, excludeIds);
    if (!passage) continue;

    const snippet = passage.text.length > 80 ? passage.text.slice(0, 77) + '...' : passage.text;

    for (const sub of subs) {
      try {
        await sendPush(sub, {
          title: `📖 ${passage.bookTitle}`,
          body: snippet,
          url: `/?passageId=${passage.id}`,
          tag: 'daily-passage',
        });
        await db.insert(pushHistory).values({
          id: crypto.randomUUID(),
          userId: sub.userId,
          passageId: passage.id,
          sentAt: new Date(),
        });
        sent++;
      } catch {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        failed++;
      }
    }
    results.push({ userId, passageId: passage.id });
  }

  return NextResponse.json({ sent, failed, personalized: results });
}
