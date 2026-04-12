import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions, passages, pushHistory } from '@/db/schema';
import { sendPush } from '@/lib/push';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// GET /api/cron/daily-push — Vercel Cron triggers this daily
// Protected by CRON_SECRET (Vercel sets Authorization header automatically)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pick a random passage
  const [passage] = await db.select().from(passages).orderBy(sql`RANDOM()`).limit(1);
  if (!passage) {
    return NextResponse.json({ error: 'No passages available' }, { status: 500 });
  }

  const allSubs = await db.select().from(pushSubscriptions);
  if (allSubs.length === 0) {
    return NextResponse.json({ message: 'No subscribers', passageId: passage.id });
  }

  const snippet = passage.text.length > 80 ? passage.text.slice(0, 77) + '...' : passage.text;

  let sent = 0;
  let failed = 0;
  for (const sub of allSubs) {
    try {
      await sendPush(sub, {
        title: `📖 ${passage.bookTitle}`,
        body: snippet,
        url: `/?passageId=${passage.id}`,
        tag: 'daily-passage',
      });
      // Record push history
      await db.insert(pushHistory).values({
        id: crypto.randomUUID(),
        userId: sub.userId,
        passageId: passage.id,
        sentAt: new Date(),
      });
      sent++;
    } catch {
      await db.delete(pushSubscriptions).where(sql`id = ${sub.id}`);
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, passageId: passage.id });
}
