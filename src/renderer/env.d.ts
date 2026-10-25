import type { NativeBridge } from '@core/api';

declare global {
  interface Window {
    /** Raw IPC functions exposed by the preload script; use lib/api.ts instead. */
    mjournalIpc?: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
    mjournalNative?: NativeBridge;
  }
}

export {};
