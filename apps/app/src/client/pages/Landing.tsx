import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { logtoClient } from '../lib/logto';

export default function Landing() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    logtoClient.isAuthenticated().then(setAuthed);
  }, []);

  return (
    <div className="rp-shell grid min-h-dvh place-items-center px-5 py-10">
      <div className="rp-aurora" aria-hidden="true" />
      <main className="rp-glass-card relative z-10 w-full max-w-md overflow-hidden p-7 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.4rem] bg-gradient-to-br from-[#f4daa0] to-[#b9782f] text-3xl font-black text-[#1d140d] shadow-2xl">頁</div>
        <p className="rp-eyebrow mt-7">RandomPage OS</p>
        <h1 className="mt-3 text-5xl font-black leading-[0.9] tracking-[-0.08em] text-base-content">A page chosen for you.</h1>
        <p className="mx-auto mt-5 max-w-sm text-sm leading-6 opacity-65">
          Discover curated book passages that learn from your shelf, skips, and reading history.
        </p>
        <div className="mt-7 flex flex-col gap-3">
          {authed === null ? (
            <span className="loading loading-spinner loading-md mx-auto text-warning" />
          ) : authed ? (
            <Link to="/discover" className="btn btn-primary">Open App</Link>
          ) : (
            <Link to="/signin" className="btn btn-primary">Sign in to start reading</Link>
          )}
          <Link to="/discover" className="btn btn-ghost">Explore anonymously →</Link>
        </div>
      </main>
    </div>
  );
}
