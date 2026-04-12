import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { pushHistory, passages } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { rebuildUserPreferences } from '@/lib/preferences';

export const dynamic = 'force-dynamic';

// GET /api/push/history — get current user's push history
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const history = await db
    .select({
      id: pushHistory.id,
      passageId: pushHistory.passageId,
      sentAt: pushHistory.sentAt,
      readAt: pushHistory.readAt,
      text: passages.text,
      bookTitle: passages.bookTitle,
      author: passages.author,
      chapter: passages.chapter,
      tags: passages.tags,
      language: passages.language,
    })
    .from(pushHistory)
    .innerJoin(passages, eq(pushHistory.passageId, passages.id))
    .where(eq(pushHistory.userId, session.userId))
    .orderBy(desc(pushHistory.sentAt))
    .limit(50);

  return NextResponse.json(
    history.map((h) => ({
      ...h,
      tags: typeof h.tags === 'string' ? JSON.parse(h.tags) : h.tags,
    }))
  );
}

// PATCH /api/push/history — mark push as read
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { pushHistoryId } = await req.json();
  if (!pushHistoryId) {
    return NextResponse.json({ error: 'Missing pushHistoryId' }, { status: 400 });
  }

  await db
    .update(pushHistory)
    .set({ readAt: new Date() })
    .where(eq(pushHistory.id, pushHistoryId));

  // Reading a push item updates preferences (implicit interest signal)
  rebuildUserPreferences(session.userId).catch(() => {});

  return NextResponse.json({ ok: true });
}
