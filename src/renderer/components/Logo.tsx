/** The mJournal mark (same drawing as the app icon) and wordmark. */
import { useId } from 'react';

export function LogoMark({ size = 30, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId();
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-tile`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f3bcc7" />
          <stop offset="1" stopColor="#c7a3d6" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}-tile)`} />
      <path
        d="M128 370V240c0-44 25-72 60-72s60 28 60 72v130M248 240c0-44 25-72 60-72s60 28 60 72v92c0 24 13 38 36 38"
        fill="none"
        stroke="#fff9f2"
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className={animated ? 'logo-sparkle' : undefined}
        d="M404 70c4 27 14 37 41 41-27 4-37 14-41 41-4-27-14-37-41-41 27-4 37-14 41-41z"
        fill="#fff3d6"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-m">m</span>Journal
    </span>
  );
}
