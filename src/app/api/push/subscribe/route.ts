import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// Subscribe to push
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { subscription } = await req.json();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  // Upsert: delete existing for this endpoint, then insert
  await db.delete(pushSubscriptions).where(
    and(
      eq(pushSubscriptions.userId, session.userId),
      eq(pushSubscriptions.endpoint, subscription.endpoint)
    )
  );

  await db.insert(pushSubscriptions).values({
    id: randomUUID(),
    userId: session.userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}

// Unsubscribe
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint } = await req.json();
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });

  await db.delete(pushSubscriptions).where(
    and(
      eq(pushSubscriptions.userId, session.userId),
      eq(pushSubscriptions.endpoint, endpoint)
    )
  );

  return NextResponse.json({ ok: true });
}

// Check subscription status
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, session.userId));

  return NextResponse.json({ subscribed: subs.length > 0, count: subs.length });
}
