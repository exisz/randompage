import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getWeightedPassage } from '@/lib/preferences';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const passage = await getWeightedPassage(session.userId);

  if (!passage) {
    return NextResponse.json({ error: 'No passages' }, { status: 404 });
  }

  return NextResponse.json({
    ...passage,
    tags: JSON.parse(passage.tags),
  });
}
