import { useState } from 'react';
import type { ShareablePassage } from './SharePassageButton';

interface SharePassageImageButtonProps {
  passage: ShareablePassage;
  compact?: boolean;
  className?: string;
  label?: string;
}

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const CARD_PADDING = 88;
const EXPORT_EXCERPT_LENGTH = 560;

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateForCard(text: string) {
  const normalized = normalizeText(text);
  return normalized.length > EXPORT_EXCERPT_LENGTH
    ? `${normalized.slice(0, EXPORT_EXCERPT_LENGTH).trim()}…`
    : normalized;
}

function canonicalPassageUrl(passageId: string) {
  return `${window.location.origin}/discover?passageId=${encodeURIComponent(passageId)}`;
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  maxLines: number,
) {
  const visibleLines = lines.slice(0, maxLines);
  visibleLines.forEach((line, index) => {
    const rendered = index === maxLines - 1 && lines.length > maxLines ? `${line.replace(/[.…]*$/, '')}…` : line;
    ctx.fillText(rendered, x, y + index * lineHeight);
  });
  return y + visibleLines.length * lineHeight;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not render passage card image'));
    }, 'image/png', 0.95);
  });
}

async function copyImageToClipboard(blob: Blob) {
  const ClipboardItemCtor = (window as typeof window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!ClipboardItemCtor || !navigator.clipboard?.write) return false;
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })]);
  return true;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function renderPassageCard(passage: ShareablePassage) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported on this device');

  const paperGradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  paperGradient.addColorStop(0, '#fff7e6');
  paperGradient.addColorStop(0.45, '#f5ead1');
  paperGradient.addColorStop(1, '#e8d7b0');
  ctx.fillStyle = paperGradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glow = ctx.createRadialGradient(890, 210, 0, 890, 210, 560);
  glow.addColorStop(0, 'rgba(178, 93, 52, 0.34)');
  glow.addColorStop(0.55, 'rgba(178, 93, 52, 0.08)');
  glow.addColorStop(1, 'rgba(178, 93, 52, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#704723';
  ctx.lineWidth = 2;
  for (let x = -CARD_HEIGHT; x < CARD_WIDTH; x += 58) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + CARD_HEIGHT, CARD_HEIGHT);
    ctx.stroke();
  }
  ctx.restore();

  roundRectPath(ctx, 54, 54, CARD_WIDTH - 108, CARD_HEIGHT - 108, 64);
  ctx.strokeStyle = 'rgba(78, 45, 23, 0.22)';
  ctx.lineWidth = 3;
  ctx.stroke();

  roundRectPath(ctx, CARD_PADDING, CARD_PADDING, CARD_WIDTH - CARD_PADDING * 2, CARD_HEIGHT - CARD_PADDING * 2, 46);
  ctx.fillStyle = 'rgba(255, 252, 242, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(98, 57, 31, 0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#7a3f22';
  ctx.font = '700 26px Georgia, serif';
  ctx.letterSpacing = '6px';
  ctx.fillText('RANDOMPAGE', CARD_PADDING + 44, CARD_PADDING + 76);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = 'rgba(90, 55, 31, 0.22)';
  ctx.font = '700 180px Georgia, serif';
  ctx.fillText('“', CARD_PADDING + 34, CARD_PADDING + 238);

  ctx.fillStyle = '#2f2419';
  ctx.font = '48px Georgia, "Times New Roman", serif';
  const excerpt = truncateForCard(passage.text);
  const quoteLines = wrapCanvasText(ctx, excerpt, CARD_WIDTH - CARD_PADDING * 2 - 110);
  const quoteEndY = drawWrappedText(ctx, quoteLines, CARD_PADDING + 54, CARD_PADDING + 260, 70, 11);

  const metaY = Math.min(quoteEndY + 92, CARD_HEIGHT - CARD_PADDING - 250);
  ctx.fillStyle = '#6d3d22';
  ctx.fillRect(CARD_PADDING + 54, metaY - 18, 88, 3);

  ctx.fillStyle = '#2f2419';
  ctx.font = '700 38px Georgia, "Times New Roman", serif';
  const titleLines = wrapCanvasText(ctx, passage.bookTitle, CARD_WIDTH - CARD_PADDING * 2 - 110);
  const titleEndY = drawWrappedText(ctx, titleLines, CARD_PADDING + 54, metaY + 46, 48, 2);

  ctx.fillStyle = 'rgba(47, 36, 25, 0.72)';
  ctx.font = '30px Georgia, "Times New Roman", serif';
  ctx.fillText(passage.author, CARD_PADDING + 54, titleEndY + 40);

  const footerY = CARD_HEIGHT - CARD_PADDING - 98;
  ctx.fillStyle = 'rgba(47, 36, 25, 0.58)';
  ctx.font = '24px Georgia, "Times New Roman", serif';
  ctx.fillText('Book passages for the margins of your day', CARD_PADDING + 54, footerY);

  ctx.textAlign = 'right';
  ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(canonicalPassageUrl(passage.id).replace(/^https?:\/\//, ''), CARD_WIDTH - CARD_PADDING - 54, footerY + 46);
  ctx.textAlign = 'left';

  return canvasToBlob(canvas);
}

export default function SharePassageImageButton({ passage, compact = false, className = '', label }: SharePassageImageButtonProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clearStatusLater = () => window.setTimeout(() => setStatus(null), 3000);

  const handleShareImage = async () => {
    setBusy(true);
    setStatus(null);

    try {
      const blob = await renderPassageCard(passage);
      const filename = `randompage-${passage.id}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      const sharePayload = {
        title: `${passage.bookTitle} — ${passage.author}`,
        text: 'A RandomPage passage card',
        files: [file],
      };

      if (navigator.share && navigator.canShare?.(sharePayload)) {
        await navigator.share(sharePayload);
        setStatus('Image shared');
      } else if (await copyImageToClipboard(blob)) {
        setStatus('Image copied');
      } else {
        downloadBlob(blob, filename);
        setStatus('Image downloaded');
      }
      clearStatusLater();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error(error);
      setStatus('Image failed');
      clearStatusLater();
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = label ?? (compact ? 'Card' : 'Share card');

  return (
    <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        className={`btn ${compact ? 'btn-xs btn-outline' : 'btn-outline'} rounded-2xl border-amber-700/30 bg-amber-50/10`}
        onClick={handleShareImage}
        disabled={busy}
        aria-label={`Share passage from ${passage.bookTitle} as an image card`}
      >
        {busy ? <span className="loading loading-spinner loading-xs" /> : null}
        {buttonLabel}
      </button>
      {status && (
        <span className={`badge ${status === 'Image failed' ? 'badge-error' : 'badge-success'} badge-sm whitespace-nowrap`} role="status">
          {status}
        </span>
      )}
    </div>
  );
}
