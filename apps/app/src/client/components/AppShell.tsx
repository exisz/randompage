import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const navItems = [
  { to: '/discover', label: 'Discover', icon: '✦' },
  { to: '/bookmarks', label: 'Shelf', icon: '▤' },
  { to: '/history', label: 'History', icon: '◷' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

interface AppShellProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
}

export default function AppShell({ eyebrow = 'RandomPage OS', title, subtitle, children, maxWidth = 'max-w-2xl' }: AppShellProps) {
  return (
    <div className="rp-shell min-h-dvh text-base-content">
      <div className="rp-aurora" aria-hidden="true" />
      <header className="rp-topbar">
        <Link to="/discover" className="rp-brand" aria-label="RandomPage home">
          <span className="rp-brand-mark">頁</span>
          <span>
            <span className="rp-brand-title">RandomPage</span>
            <span className="rp-brand-subtitle">personal passage engine</span>
          </span>
        </Link>
        <div className="rp-status-pill">
          <span className="rp-status-dot" /> tuned for you
        </div>
      </header>

      <main className={`rp-main ${maxWidth} mx-auto`}>
        <section className="rp-hero-panel">
          <p className="rp-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </section>
        {children}
      </main>

      <nav className="rp-bottom-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `rp-nav-item ${isActive ? 'is-active' : ''}`}>
            <span className="rp-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
