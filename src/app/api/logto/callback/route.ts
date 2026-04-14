import { handleSignIn } from '@logto/next/server-actions';
import { logtoConfig } from '@/lib/logto';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  await handleSignIn(logtoConfig, request.nextUrl.searchParams);
  redirect('/');
}
