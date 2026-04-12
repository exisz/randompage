import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions, passages, pushHistory } from '@/db/schema';
import { sendPush } from '@/lib/push';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// POST /api/push/send — trigger daily push to all subscribers
// Protected by PUSH_SECRET header
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-push-secret');
  if (!secret || secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pick a random passage
  const [passage] = await db.select().from(passages).orderBy(sql`RANDOM()`).limit(1);
  if (!passage) {
    return NextResponse.json({ error: 'No passages available' }, { status: 500 });
  }

  const allSubs = await db.select().from(pushSubscriptions);
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
      // Record push history for this user
      await db.insert(pushHistory).values({
        id: crypto.randomUUID(),
        userId: sub.userId,
        passageId: passage.id,
        sentAt: new Date(),
      });
      sent++;
    } catch {
      // Subscription expired or invalid — clean up
      await db.delete(pushSubscriptions).where(sql`id = ${sub.id}`);
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, passageId: passage.id });
}
