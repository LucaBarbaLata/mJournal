/**
 * Window-chrome colors shared by the main process (title bar overlay) and the
 * stylesheet (--chrome-bg in tokens.css). Keep the two in sync.
 */
export const CHROME_COLORS = {
  light: { background: '#f8f1e8', symbol: '#5b4a57' },
  dark: { background: '#1b1720', symbol: '#e8dde3' },
} as const;

export type ResolvedTheme = keyof typeof CHROME_COLORS;
