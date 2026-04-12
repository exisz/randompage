import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { passages } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [passage] = await db.select().from(passages).where(eq(passages.id, id)).limit(1);
  if (!passage) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...passage,
    tags: typeof passage.tags === 'string' ? JSON.parse(passage.tags) : passage.tags,
  });
}
