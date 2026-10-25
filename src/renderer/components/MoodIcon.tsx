/**
 * Hand-drawn mood faces (and a few symbols for custom moods). Each mood has
 * its own expression and shape, so moods never depend on color alone.
 */
import type { ReactElement } from 'react';
import type { MoodColor, MoodIcon as MoodIconName } from '@core/moods';

const INK = 'var(--mood-ink)';
const BLUSH = 'rgb(236 124 150 / 0.45)';

const stroke = { fill: 'none', stroke: INK, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const dotEyes = (
  <>
    <circle cx="11.8" cy="15" r="1.35" fill={INK} />
    <circle cx="20.2" cy="15" r="1.35" fill={INK} />
  </>
);

const blush = (
  <>
    <ellipse cx="9.4" cy="19" rx="1.9" ry="1.1" fill={BLUSH} />
    <ellipse cx="22.6" cy="19" rx="1.9" ry="1.1" fill={BLUSH} />
  </>
);

const FACES: Partial<Record<MoodIconName, ReactElement>> = {
  radiant: (
    <>
      <path d="M9.9 15.3q1.9-2.3 3.8 0M18.3 15.3q1.9-2.3 3.8 0" {...stroke} />
      <path d="M11.4 18.6h9.2q-.6 4.6-4.6 4.6t-4.6-4.6Z" fill={INK} />
      <path d="M13.6 21.9q2.4-1.4 4.8 0q-1 1.1-2.4 1.1t-2.4-1.1Z" fill={BLUSH} />
      {blush}
    </>
  ),
  happy: (
    <>
      {dotEyes}
      <path d="M11.9 19.4q4.1 3.9 8.2 0" {...stroke} />
      {blush}
    </>
  ),
  calm: (
    <>
      <path d="M10.2 15.4q1.75 1.7 3.5 0M18.3 15.4q1.75 1.7 3.5 0" {...stroke} />
      <path d="M13.4 20.2q2.6 1.9 5.2 0" {...stroke} />
      <ellipse cx="9.6" cy="18.6" rx="1.6" ry="0.9" fill={BLUSH} opacity="0.6" />
      <ellipse cx="22.4" cy="18.6" rx="1.6" ry="0.9" fill={BLUSH} opacity="0.6" />
    </>
  ),
  okay: (
    <>
      {dotEyes}
      <path d="M12.9 20.6h6.2" {...stroke} />
    </>
  ),
  tired: (
    <>
      <path d="M10.1 15.6h3.6M18.3 15.6h3.6" {...stroke} />
      <path d="M10.4 13.6q1.5.9 3 .3M21.6 13.6q-1.5.9-3 .3" {...stroke} strokeWidth={1.2} opacity="0.55" />
      <ellipse cx="16" cy="21" rx="1.5" ry="1.3" {...stroke} />
    </>
  ),
  anxious: (
    <>
      <circle cx="11.8" cy="15.4" r="1.45" fill={INK} />
      <circle cx="20.2" cy="15.4" r="1.45" fill={INK} />
      <path d="M9.6 12.3 13 11M22.4 12.3 19 11" {...stroke} />
      <path d="M11.6 21.2q1.1-1.3 2.2 0t2.2 0 2.2 0 2.2 0" {...stroke} />
    </>
  ),
  sad: (
    <>
      {dotEyes}
      <path d="M9.9 12.2 12.9 11.3M22.1 12.2 19.1 11.3" {...stroke} strokeWidth={1.3} />
      <path d="M12.2 21.8q3.8-3.4 7.6 0" {...stroke} />
      <path d="M21.9 17.2q-1.4 2-1.4 2.8a1.4 1.4 0 0 0 2.8 0q0-.8-1.4-2.8Z" fill="var(--mood-sky)" stroke={INK} strokeWidth="0.9" />
    </>
  ),
  frustrated: (
    <>
      <circle cx="11.8" cy="15.6" r="1.35" fill={INK} />
      <circle cx="20.2" cy="15.6" r="1.35" fill={INK} />
      <path d="M9.4 11.4 13.4 12.9M22.6 11.4 18.6 12.9" {...stroke} />
      <path d="M12.4 21.4q3.6-2.2 7.2 0" {...stroke} />
    </>
  ),
  overwhelmed: (
    <>
      <circle cx="11.8" cy="15" r="2.1" {...stroke} strokeWidth={1.2} />
      <circle cx="20.2" cy="15" r="2.1" {...stroke} strokeWidth={1.2} />
      <circle cx="11.8" cy="15" r="0.7" fill={INK} />
      <circle cx="20.2" cy="15" r="0.7" fill={INK} />
      <path d="M12 21.3q1.33-1.5 2.67 0t2.66 0 2.67 0" {...stroke} />
      <path d="M6.9 8.6q-1.2 1.7-1.2 2.4a1.2 1.2 0 0 0 2.4 0q0-.7-1.2-2.4Z" fill="var(--mood-sky)" stroke={INK} strokeWidth="0.8" />
    </>
  ),
  mixed: (
    <>
      <path d="M10.1 15.4q1.75-2 3.5 0" {...stroke} />
      <circle cx="20.2" cy="15" r="1.35" fill={INK} />
      <path d="M11.6 20.1q2.3 1.9 4.6 0h4.3" {...stroke} />
    </>
  ),
};

const SYMBOLS: Partial<Record<MoodIconName, ReactElement>> = {
  heart: <path d="M16 23s-6.2-3.8-6.2-8.3A3.4 3.4 0 0 1 16 12.8a3.4 3.4 0 0 1 6.2 1.9C22.2 19.2 16 23 16 23Z" {...stroke} />,
  star: <path d="m16 9.6 2 4.1 4.5.6-3.3 3.1.8 4.5-4-2.2-4 2.2.8-4.5-3.3-3.1 4.5-.6Z" {...stroke} />,
  sun: (
    <>
      <circle cx="16" cy="16.5" r="3.4" {...stroke} />
      <path d="M16 9.6v1.6M16 21.8v1.6M9.1 16.5h1.6M21.3 16.5h1.6M11.1 11.6l1.1 1.1M19.8 20.3l1.1 1.1M11.1 21.4l1.1-1.1M19.8 12.7l1.1-1.1" {...stroke} />
    </>
  ),
  moon: <path d="M21.6 19.2a6.4 6.4 0 1 1-8-8.2 5.2 5.2 0 0 0 8 8.2Z" {...stroke} />,
  cloud: <path d="M11.6 21.3a3.3 3.3 0 0 1-.3-6.6 4.8 4.8 0 0 1 9.2-.6 3.6 3.6 0 0 1 .3 7.2Z" {...stroke} />,
  rain: (
    <>
      <path d="M11.6 18.5a3.1 3.1 0 0 1-.3-6.2 4.6 4.6 0 0 1 8.8-.5 3.4 3.4 0 0 1 .3 6.7Z" {...stroke} />
      <path d="M12.6 21.2l-.7 1.6M16 21.2l-.7 1.6M19.4 21.2l-.7 1.6" {...stroke} />
    </>
  ),
  leaf: <path d="M10.4 22.4c0-6.5 4.1-10.9 11.2-11.3-.4 7.3-4.9 11.3-11.2 11.3Zm0 0 5.2-5.2" {...stroke} />,
  flower: (
    <>
      <circle cx="16" cy="16.5" r="1.9" {...stroke} />
      <path d="M16 14.6c-2.3-3.4.2-5.1 0-5.1s2.3 1.7 0 5.1ZM17.8 15.9c2.6-3.2 5-1.4 4.9-1.5s-.9 2.8-4.9 1.5ZM17.1 18.2c3.9 1.2 3.1 4 3.1 3.9s-2.9.3-3.1-3.9ZM14.9 18.2c-.2 4.2-3.1 3.9-3.1 3.9s-.8-2.7 3.1-3.9ZM14.2 15.9c-4 1.3-4.9-1.5-4.9-1.5s2.3-1.7 4.9 1.5Z" {...stroke} strokeWidth={1.3} />
    </>
  ),
};

interface MoodIconProps {
  icon: MoodIconName;
  color: MoodColor;
  size?: number;
  /** Accessible name; omit when a visible label is next to the icon. */
  title?: string;
  className?: string;
}

export function MoodIcon({ icon, color, size = 28, title, className }: MoodIconProps) {
  const fill = `var(--mood-${color})`;
  const isMixed = icon === 'mixed';
  const face = FACES[icon];
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {isMixed ? (
        <>
          <path d="M16 4a12.5 12.5 0 0 0 0 25Z" fill="var(--mood-rose)" />
          <path d="M16 4a12.5 12.5 0 0 1 0 25Z" fill="var(--mood-sky)" />
        </>
      ) : (
        <circle cx="16" cy="16.5" r="12.5" fill={fill} />
      )}
      <circle cx="16" cy="16.5" r="12.5" fill="none" stroke={INK} strokeOpacity="0.16" strokeWidth="1.2" />
      {icon === 'radiant' && (
        <path d="M27.4 3.2c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9Z" fill="var(--gold-300)" />
      )}
      {icon === 'tired' && <path d="M24.6 4.8h2.6l-2.6 3h2.6" {...stroke} strokeWidth={1.2} opacity="0.6" />}
      {face ?? SYMBOLS[icon]}
    </svg>
  );
}
