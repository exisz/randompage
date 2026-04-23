import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logtoClient } from '../lib/logto';

export default function Callback() {
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await logtoClient.handleSignInCallback(window.location.href);
        navigate('/discover', { replace: true });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [navigate]);

  return (
    <div className="hero min-h-screen">
      <div className="hero-content text-center">
        {err ? (
          <div className="alert alert-error max-w-md">
            <h3 className="font-bold">Sign-in failed</h3>
            <p className="text-sm">{err}</p>
            <a href="/" className="link mt-2">← Back</a>
          </div>
        ) : (
          <div>
            <span className="loading loading-spinner loading-lg" />
            <p className="mt-4 opacity-70">Finishing sign-in…</p>
          </div>
        )}
      </div>
    </div>
  );
}
