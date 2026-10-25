/** Line icons drawn on a 24px grid. Decorative by default; pass `label` for a standalone icon. */
import type { SVGProps } from 'react';

const PATHS = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M6 18l1.3-1.3M16.7 7.3 18 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.2" />
      <path d="M3.5 9.6h17M8 3.2v3.4M16 3.2v3.4" />
      <path d="M8.2 13.4h.01M12 13.4h.01M15.8 13.4h.01M8.2 16.8h.01M12 16.8h.01" strokeWidth="2.4" />
    </>
  ),
  journal: (
    <>
      <path d="M6.5 3.8h10.2a2.3 2.3 0 0 1 2.3 2.3v13.1a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5.3a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M5 17.6a2 2 0 0 1 2-1.9h12M9.5 3.8v6.4l1.7-1.3 1.7 1.3V3.8" />
    </>
  ),
  memories: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
      <path d="m6.5 16.5 3.6-4.1a1 1 0 0 1 1.5 0l2.2 2.4 1.2-1.2a1 1 0 0 1 1.4 0l1.6 1.7" />
      <circle cx="15.6" cy="9" r="1.5" />
    </>
  ),
  month: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13.5" rx="2.8" />
      <path d="m4.3 7.2 6.4 5a2 2 0 0 0 2.6 0l6.4-5" />
    </>
  ),
  insights: (
    <>
      <path d="M5.5 19.5v-5M10 19.5V10M14.5 19.5v-7M19 19.5V5.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9.5M17.5 7H20M4 17h3M11 17h9M4 12h5M13 12h7" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
      <circle cx="11" cy="12" r="2" />
    </>
  ),
  'chevron-left': <path d="M14.5 6 8.5 12l6 6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="m6.8 6.8 10.4 10.4M17.2 6.8 6.8 17.2" />,
  heart: <path d="M12 19.3s-7.2-4.4-7.2-9.7A4 4 0 0 1 12 7.4a4 4 0 0 1 7.2 2.2c0 5.3-7.2 9.7-7.2 9.7Z" />,
  star: (
    <path d="m12 4.2 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7Z" strokeLinejoin="round" />
  ),
  shuffle: (
    <path d="M4 7.5h3c4.2 0 5.3 9 9.5 9H20M17.6 14l2.4 2.5-2.4 2.5M4 16.5h3c1.6 0 2.7-1.3 3.6-3M13.4 10.5c.9-1.7 2-3 3.6-3H20M17.6 5 20 7.5 17.6 10" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.3" />
      <path d="m16 16 4 4" />
    </>
  ),
  'image-plus': (
    <>
      <path d="M20.5 12.5v4.3a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2V8.2A3.2 3.2 0 0 1 6.7 5h5.8" />
      <path d="m6.5 16.5 3.6-4.1a1 1 0 0 1 1.5 0l2.2 2.4 1.2-1.2a1 1 0 0 1 1.4 0l1.6 1.7M18 3.5v6M15 6.5h6" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.9 11.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />,
  restore: <path d="M5 9.5h9.2a4.8 4.8 0 0 1 0 9.6H9.5M8.5 6 5 9.5 8.5 13" />,
  check: <path d="m5 12.5 4.3 4.3L19 7.4" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.6" />,
  download: <path d="M12 4v11M7.5 10.8 12 15.2l4.5-4.4M5 19.5h14" />,
  upload: <path d="M12 19.5V8.5M7.5 12.7 12 8.3l4.5 4.4M5 4.5h14" />,
  folder: <path d="M3.5 7.6A2.1 2.1 0 0 1 5.6 5.5h3.9l2 2.1h6.9a2.1 2.1 0 0 1 2.1 2.1v7.8a2.1 2.1 0 0 1-2.1 2.1H5.6a2.1 2.1 0 0 1-2.1-2.1Z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2M12 7.8h.01" />
    </>
  ),
  sparkle: (
    <path
      d="M12 3.8c.6 4.3 2.4 6 6.6 6.6-4.2.6-6 2.4-6.6 6.6-.6-4.2-2.4-6-6.6-6.6 4.2-.6 6-2.3 6.6-6.6Z"
      strokeLinejoin="round"
    />
  ),
  feather: <path d="M19.5 4.5C11.8 4.5 7 9.6 7 16.8L4.5 19.5M7 16.8c4.6 0 8.1-2.3 10.1-6.3M10.2 13.2h4.6" />,
  'eye-off': (
    <path d="M10.6 6.2A8.6 8.6 0 0 1 12 6c5.5 0 8.5 6 8.5 6a14.6 14.6 0 0 1-2.2 2.9M6.4 7.7C4.5 9.2 3.5 12 3.5 12s3 6 8.5 6c1.4 0 2.6-.4 3.7-.9M4.5 4.5l15 15M9.9 10a3 3 0 0 0 4.1 4.1" />
  ),
  eye: (
    <>
      <path d="M3.5 12S6.5 6 12 6s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'arrow-up': <path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5" />,
  'arrow-down': <path d="M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.8v1.6M12 18.6v1.6M3.8 12h1.6M18.6 12h1.6M6.2 6.2l1.1 1.1M16.7 16.7l1.1 1.1M6.2 17.8l1.1-1.1M16.7 7.3l1.1-1.1" />
    </>
  ),
  moon: <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z" />,
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pencil: <path d="m14.5 6 3.5 3.5M5 19l1-4.3L15.8 5a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L9.3 18Z" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.4" />
      <path d="M8.3 10.5V8a3.7 3.7 0 0 1 7.4 0v2.5" />
    </>
  ),
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Zm3.5 2.8a2 2 0 0 0 4 0" />,
  sprout: (
    <path d="M12 20v-7.5M12 12.5c0-3.6-2.6-6.2-6.5-6.2 0 3.6 2.6 6.2 6.5 6.2ZM12 10.6c0-3 2.2-5.1 5.7-5.1 0 3-2.2 5.1-5.7 5.1Z" />
  ),
  quote: <path d="M9.5 8.5c-2.5.8-4 2.7-4 5.5v2.5h4v-4h-2.3M18.5 8.5c-2.5.8-4 2.7-4 5.5v2.5h4v-4h-2.3" />,
  photo: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" />
      <circle cx="12" cy="12" r="3.3" />
    </>
  ),
  'broken-image': (
    <>
      <path d="M20.5 11V7.7a3.2 3.2 0 0 0-3.2-3.2H6.7a3.2 3.2 0 0 0-3.2 3.2v8.6a3.2 3.2 0 0 0 3.2 3.2h5.8" />
      <path d="m6.5 15.5 3.1-3.4a1 1 0 0 1 1.5 0l1.4 1.6M16 15.5l4 4M20 15.5l-4 4" />
    </>
  ),
  pen: <path d="M4.5 19.5h15M6.5 15.5 15.6 6.4a1.7 1.7 0 0 1 2.4 2.4L8.9 17.9 5.5 18.5Z" />,
  leaf: <path d="M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14Zm0 0 6.5-6.5" />,
  letter: (
    <>
      <path d="M6 3.5h8.5L18 7v13.5H6Z" />
      <path d="M14 3.5V7.5h4M9 11.5h6M9 14.5h6M9 17.5h3.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  label?: string;
  filled?: boolean;
}

export function Icon({ name, size = 20, label, filled = false, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
