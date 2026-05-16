import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { logtoClient } from '../lib/logto';

export default function Landing() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    logtoClient.isAuthenticated().then(setAuthed);
  }, []);

  return (
    <div className="hero min-h-screen bg-base-100">
      <div className="hero-content text-center max-w-xl">
        <div className="card bg-base-200 shadow-xl w-full">
          <div className="card-body gap-4">
            <h1 className="card-title justify-center text-4xl font-serif">📖 RandomPage</h1>
            <p className="opacity-70">
              Discover curated passages from literature — delivered daily, bookmarked forever.
            </p>
            {authed === null ? (
              <span className="loading loading-spinner loading-md" />
            ) : authed ? (
              <Link to="/discover" className="btn btn-primary">Open App</Link>
            ) : (
              <Link to="/signin" className="btn btn-primary">Sign in to start reading</Link>
            )}
            <div className="divider">or browse anonymously</div>
            <Link to="/discover" className="btn btn-ghost btn-sm">
              Explore passages →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
