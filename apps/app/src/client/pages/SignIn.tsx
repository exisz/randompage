import { useEffect } from 'react';
import { logtoClient, redirectUri } from '../lib/logto';

export default function SignIn() {
  useEffect(() => {
    logtoClient.signIn(redirectUri);
  }, []);

  return (
    <div className="hero min-h-screen">
      <div className="hero-content text-center">
        <span className="loading loading-spinner loading-lg" />
        <p className="ml-4 opacity-70">Redirecting to sign in…</p>
      </div>
    </div>
  );
}
