import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getWeightedPassage } from '@/lib/preferences';
import { db } from '@/db';
import { pushHistory, passages } from '@/db/schema';
import { and, eq, sql, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const preferUnread = req.nextUrl.searchParams.get('preferUnread') === '1';

  // PLANET-1094: prefer unread push (the inbox principle)
  if (preferUnread) {
    const unread = await db
      .select({
        pushHistoryId: pushHistory.id,
        id: passages.id,
        text: passages.text,
        bookTitle: passages.bookTitle,
        author: passages.author,
        chapter: passages.chapter,
        tags: passages.tags,
        language: passages.language,
      })
      .from(pushHistory)
      .innerJoin(passages, eq(pushHistory.passageId, passages.id))
      .where(and(eq(pushHistory.userId, session.userId), sql`${pushHistory.readAt} IS NULL`))
      .orderBy(desc(pushHistory.sentAt))
      .limit(1);

    if (unread.length > 0) {
      const item = unread[0];
      // Mark as read (user is now viewing it)
      await db
        .update(pushHistory)
        .set({ readAt: new Date() })
        .where(eq(pushHistory.id, item.pushHistoryId));
      return NextResponse.json({
        id: item.id,
        text: item.text,
        bookTitle: item.bookTitle,
        author: item.author,
        chapter: item.chapter,
        tags: JSON.parse(item.tags),
        language: item.language,
        source: 'push',
        pushHistoryId: item.pushHistoryId,
      });
    }
  }

  const passage = await getWeightedPassage(session.userId);

  if (!passage) {
    return NextResponse.json({ error: 'No passages' }, { status: 404 });
  }

  return NextResponse.json({
    ...passage,
    tags: JSON.parse(passage.tags),
    source: 'random',
  });
}
