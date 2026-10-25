/** Small decorative illustrations: sprigs, flowers, sparkles. Always aria-hidden. */
import type { CSSProperties } from 'react';

interface DecoProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Sparkle({ size = 16, className, style, color = 'var(--gold-300)' }: DecoProps & { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true">
      <path d="M12 2.5c.8 5.4 3.1 7.7 8.5 8.5-5.4.8-7.7 3.1-8.5 8.5-.8-5.4-3.1-7.7-8.5-8.5 5.4-.8 7.7-3.1 8.5-8.5Z" fill={color} />
    </svg>
  );
}

export function Sparkles({ size = 44, className, style }: DecoProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} style={style} aria-hidden="true">
      <path d="M30 6c.9 6 3.5 8.6 9.5 9.5-6 .9-8.6 3.5-9.5 9.5-.9-6-3.5-8.6-9.5-9.5 6-.9 8.6-3.5 9.5-9.5Z" fill="var(--gold-300)" />
      <path d="M13 24c.5 3.4 2 4.9 5.4 5.4-3.4.5-4.9 2-5.4 5.4-.5-3.4-2-4.9-5.4-5.4 3.4-.5 4.9-2 5.4-5.4Z" fill="var(--lavender-300)" />
      <circle cx="35" cy="36" r="2" fill="var(--rose-300)" />
    </svg>
  );
}

export function Sprig({ size = 40, className, style }: DecoProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} style={style} aria-hidden="true">
      <path d="M10 42C18 33 25 21 38 7" fill="none" stroke="var(--sage-600)" strokeWidth="1.6" strokeLinecap="round" />
      <g fill="var(--sage-300)" stroke="var(--sage-600)" strokeWidth="1">
        <path d="M17 33c-5 0-7.5-2.5-8-6 4.5-.5 7.5 1.5 8 6Z" />
        <path d="M17 33c0-5 2.5-7.5 6-8 .5 4.5-1.5 7.5-6 8Z" />
        <path d="M25 22.5c-5 0-7.5-2.5-8-6 4.5-.5 7.5 1.5 8 6Z" />
        <path d="M25 22.5c0-5 2.5-7.5 6-8 .5 4.5-1.5 7.5-6 8Z" />
        <path d="M33 13c-4 .2-6.3-1.6-7-4.5 3.7-.7 6.2.8 7 4.5Z" />
      </g>
    </svg>
  );
}

export function Flower({ size = 28, className, style }: DecoProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} style={style} aria-hidden="true">
      <g fill="var(--rose-200)" stroke="var(--rose-400)" strokeWidth="0.9">
        <ellipse cx="16" cy="9" rx="4" ry="5.5" />
        <ellipse cx="16" cy="9" rx="4" ry="5.5" transform="rotate(72 16 16)" />
        <ellipse cx="16" cy="9" rx="4" ry="5.5" transform="rotate(144 16 16)" />
        <ellipse cx="16" cy="9" rx="4" ry="5.5" transform="rotate(216 16 16)" />
        <ellipse cx="16" cy="9" rx="4" ry="5.5" transform="rotate(288 16 16)" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="var(--gold-300)" />
    </svg>
  );
}

/** An open journal with a sprig, used for empty days and an empty history. */
export function JournalArt({ size = 132 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 120" width={size} height={(size * 120) / 160} aria-hidden="true">
      <ellipse cx="80" cy="104" rx="58" ry="7" fill="var(--rose-100)" />
      <path d="M22 30c18-6 38-5 58 6v62c-20-11-40-12-58-6Z" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <path d="M138 30c-18-6-38-5-58 6v62c20-11 40-12 58-6Z" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <path d="M33 45c13-3 25-2 37 4M33 56c13-3 25-2 37 4M33 67c10-2 20-1 30 3M90 49c12-6 24-7 37-4M90 60c12-6 24-7 37-4" stroke="var(--rose-200)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M118 30v20l5-4 5 4V31.5" fill="var(--rose-300)" />
      <g transform="translate(116 66) rotate(-18)">
        <path d="M0 30C6 22 10 12 20 0" fill="none" stroke="var(--sage-600)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M6 22c-4 0-6-2-6.5-5 3.6-.4 6 1.2 6.5 5ZM6 22c0-4 2-6 5-6.5.4 3.6-1.2 6-5 6.5ZM12 13c-3.6 0-5.6-1.8-6-4.6 3.3-.4 5.6 1.1 6 4.6ZM12 13c0-3.6 1.8-5.6 4.6-6 .4 3.3-1.1 5.6-4.6 6Z" fill="var(--sage-300)" stroke="var(--sage-600)" strokeWidth="0.8" />
      </g>
      <path d="M30 14c.6 4 2.3 5.7 6.3 6.3-4 .6-5.7 2.3-6.3 6.3-.6-4-2.3-5.7-6.3-6.3 4-.6 5.7-2.3 6.3-6.3Z" fill="var(--gold-300)" />
      <circle cx="50" cy="16" r="2" fill="var(--lavender-300)" />
    </svg>
  );
}

/** A little stack of photos, for the empty gallery. */
export function PhotosArt({ size = 132 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 120" width={size} height={(size * 120) / 160} aria-hidden="true">
      <ellipse cx="80" cy="106" rx="54" ry="6" fill="var(--lavender-100)" />
      <g transform="rotate(-9 62 60)">
        <rect x="30" y="22" width="62" height="72" rx="5" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <rect x="37" y="29" width="48" height="44" rx="3" fill="var(--sage-100)" />
        <path d="M40 70l12-13 9 9 6-6 15 10" fill="none" stroke="var(--sage-600)" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g transform="rotate(7 98 58)">
        <rect x="68" y="18" width="62" height="74" rx="5" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <rect x="75" y="25" width="48" height="45" rx="3" fill="var(--rose-100)" />
        <circle cx="110" cy="37" r="5" fill="var(--gold-300)" />
        <path d="M78 66l13-13 10 9 6-5 13 10" fill="none" stroke="var(--rose-400)" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <path d="M134 12c.6 4 2.3 5.7 6.3 6.3-4 .6-5.7 2.3-6.3 6.3-.6-4-2.3-5.7-6.3-6.3 4-.6 5.7-2.3 6.3-6.3Z" fill="var(--gold-300)" />
    </svg>
  );
}

/** A sealed letter with a flower, for the monthly recap. */
export function LetterArt({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 52" width={size} height={(size * 52) / 64} aria-hidden="true">
      <rect x="4" y="10" width="52" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.4" />
      <path d="m5.5 12.5 22 16a4 4 0 0 0 5 0l22-16" fill="none" stroke="var(--line-strong)" strokeWidth="1.4" />
      <circle cx="30" cy="30" r="5" fill="var(--rose-300)" />
      <path d="M30 27.6c-1.4-1.6-3.6-.4-2.8 1.4.6 1.2 2.8 2.6 2.8 2.6s2.2-1.4 2.8-2.6c.8-1.8-1.4-3-2.8-1.4Z" fill="var(--paper-raised)" />
      <path d="M52 4c.5 3.2 1.8 4.5 5 5-3.2.5-4.5 1.8-5 5-.5-3.2-1.8-4.5-5-5 3.2-.5 4.5-1.8 5-5Z" fill="var(--gold-300)" />
    </svg>
  );
}
