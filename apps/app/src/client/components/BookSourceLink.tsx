import { Link } from 'react-router-dom';

type BookSourceLinkProps = {
  bookTitle: string;
  author: string;
  chapter?: string | null;
  className?: string;
  compact?: boolean;
};

export function bookSourceHref(bookTitle: string, author: string) {
  const params = new URLSearchParams({ title: bookTitle });
  if (author) params.set('author', author);
  return `/source?${params.toString()}`;
}

export default function BookSourceLink({ bookTitle, author, chapter, className = '', compact = false }: BookSourceLinkProps) {
  return (
    <Link
      to={bookSourceHref(bookTitle, author)}
      className={`group inline-flex max-w-full flex-col text-inherit transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
      aria-label={`Open source page for ${bookTitle} by ${author}`}
    >
      <span className={`truncate font-medium decoration-primary/50 group-hover:underline ${compact ? '' : 'font-serif'}`}>{bookTitle}</span>
      <span className="truncate opacity-70 group-hover:opacity-100">
        {author}{chapter ? ` · ${chapter}` : ''}
        <span className="ml-2 text-primary/80 opacity-0 transition group-hover:opacity-100">Explore book →</span>
      </span>
    </Link>
  );
}
