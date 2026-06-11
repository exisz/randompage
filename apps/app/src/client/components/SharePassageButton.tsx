import { useState } from 'react';

export interface ShareablePassage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
}

interface SharePassageButtonProps {
  passage: ShareablePassage;
  compact?: boolean;
  className?: string;
  label?: string;
}

const SHARE_EXCERPT_LENGTH = 220;

function shortExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > SHARE_EXCERPT_LENGTH
    ? `${normalized.slice(0, SHARE_EXCERPT_LENGTH).trim()}…`
    : normalized;
}

export function formatPassageShareText(passage: ShareablePassage, url: string) {
  const excerpt = shortExcerpt(passage.text);
  return `“${excerpt}”\n\n— ${passage.bookTitle}, ${passage.author}\nRead it on RandomPage: ${url}`;
}

export default function SharePassageButton({ passage, compact = false, className = '', label = 'Share' }: SharePassageButtonProps) {
  const [status, setStatus] = useState<string | null>(null);

  const handleShare = async () => {
    const origin = window.location.origin;
    const url = `${origin}/discover?passageId=${encodeURIComponent(passage.id)}`;
    const title = `${passage.bookTitle} — ${passage.author}`;
    const text = formatPassageShareText(passage, url);

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setStatus('Shared');
      } else {
        await navigator.clipboard.writeText(text);
        setStatus('Copied passage + link');
      }
      window.setTimeout(() => setStatus(null), 2500);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error(error);
      setStatus('Share failed');
      window.setTimeout(() => setStatus(null), 2500);
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        className={`btn ${compact ? 'btn-xs' : 'btn-outline'} rounded-2xl`}
        onClick={handleShare}
        aria-label={`Share passage from ${passage.bookTitle}`}
      >
        {label}
      </button>
      {status && (
        <span className={`badge ${status === 'Share failed' ? 'badge-error' : 'badge-success'} badge-sm whitespace-nowrap`} role="status">
          {status}
        </span>
      )}
    </div>
  );
}
