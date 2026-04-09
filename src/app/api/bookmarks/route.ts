import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { bookmarks } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

// GET /api/bookmarks — list user's bookmarks
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, session.userId))
    .orderBy(bookmarks.createdAt);

  return NextResponse.json(rows.map((r) => r.passageId));
}

// POST /api/bookmarks — add bookmark { passageId }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { passageId } = await req.json();
  if (!passageId) return NextResponse.json({ error: 'passageId required' }, { status: 400 });

  // Upsert — ignore if already exists
  const existing = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, session.userId), eq(bookmarks.passageId, passageId)));

  if (existing.length === 0) {
    await db.insert(bookmarks).values({
      id: crypto.randomUUID(),
      userId: session.userId,
      passageId,
      createdAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/bookmarks — remove bookmark { passageId }
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { passageId } = await req.json();
  if (!passageId) return NextResponse.json({ error: 'passageId required' }, { status: 400 });

  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, session.userId), eq(bookmarks.passageId, passageId)));

  return NextResponse.json({ ok: true });
}
