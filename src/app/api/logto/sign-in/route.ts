import { signIn } from '@logto/next/server-actions';
import { logtoConfig } from '@/lib/logto';
import { redirect } from 'next/navigation';

export async function GET() {
  await signIn(logtoConfig, {
    redirectUri: `${logtoConfig.baseUrl}/api/logto/callback`,
  });
  // signIn redirects, but just in case:
  redirect('/');
}
