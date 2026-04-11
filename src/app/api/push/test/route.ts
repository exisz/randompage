import { NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions, passages } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { sendPush } from '@/lib/push';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// POST /api/push/test — Send a test push notification to the current user
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check VAPID config
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
  }

  // Get user's subscriptions
  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, session.userId));

  if (subs.length === 0) {
    return NextResponse.json({ error: 'No push subscriptions found. Enable push in Settings first.' }, { status: 400 });
  }

  // Pick a random passage
  const [passage] = await db.select().from(passages).orderBy(sql`RANDOM()`).limit(1);
  if (!passage) {
    return NextResponse.json({ error: 'No passages available' }, { status: 500 });
  }

  const snippet = passage.text.length > 80 ? passage.text.slice(0, 77) + '...' : passage.text;

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await sendPush(sub, {
        title: `📖 [测试] ${passage.bookTitle}`,
        body: snippet,
        url: '/',
        tag: 'test-push',
      });
      sent++;
    } catch {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, passageId: passage.id });
}

// GET /api/push/test — Health check for push configuration
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasVapidPublic = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const hasVapidPrivate = !!process.env.VAPID_PRIVATE_KEY;
  const hasCronSecret = !!process.env.CRON_SECRET;

  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, session.userId));

  const totalSubs = await db.select({ count: sql<number>`count(*)` }).from(pushSubscriptions);

  return NextResponse.json({
    config: {
      vapidPublicKey: hasVapidPublic,
      vapidPrivateKey: hasVapidPrivate,
      cronSecret: hasCronSecret,
    },
    subscriptions: {
      user: subs.length,
      total: totalSubs[0]?.count ?? 0,
    },
    ready: hasVapidPublic && hasVapidPrivate && hasCronSecret,
  });
}
