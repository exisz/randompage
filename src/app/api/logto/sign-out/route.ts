import { signOut } from '@logto/next/server-actions';
import { logtoConfig } from '@/lib/logto';
import { redirect } from 'next/navigation';

export async function GET() {
  await signOut(logtoConfig, logtoConfig.baseUrl);
  redirect('/');
}
