import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getLogtoContext } from '@logto/next/server-actions';
import { logtoConfig } from '@/lib/logto';

export async function GET() {
  // Check Passkey session first
  const session = await getSession();
  if (session) {
    return NextResponse.json({ authenticated: true, user: session });
  }

  // Check Logto session
  try {
    const logtoContext = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
    if (logtoContext.isAuthenticated) {
      return NextResponse.json({
        authenticated: true,
        user: {
          userId: logtoContext.claims?.sub,
          displayName: logtoContext.userInfo?.name || logtoContext.claims?.sub || 'Logto User',
        },
        provider: 'logto',
      });
    }
  } catch {
    // Logto not configured or error, fall through
  }

  return NextResponse.json({ authenticated: false });
}
