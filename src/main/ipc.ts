/** Connects the API handlers to Electron IPC, with sender checks and safe error messages. */
import { ipcMain } from 'electron';
import { API_METHODS, channelName, type IpcEnvelope } from '@core/api';
import { UserFacingError } from '@core/validation';
import type { ApiHandlers } from './api';
import { log } from './log';

const INTERNAL_ERROR = 'Something went wrong. Your journal is safe — please try again.';

export function registerIpc(handlers: ApiHandlers, isTrustedUrl: (url: string) => boolean): void {
  for (const [namespace, methods] of Object.entries(API_METHODS)) {
    for (const method of methods) {
      const handler = (handlers as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[
        namespace
      ][method];
      ipcMain.handle(channelName(namespace, method), async (event, ...args): Promise<IpcEnvelope<unknown>> => {
        if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) {
          return { ok: false, code: 'forbidden', message: 'This request is not allowed.' };
        }
        try {
          return { ok: true, value: await handler(...args) };
        } catch (err) {
          if (err instanceof UserFacingError) return { ok: false, code: err.code, message: err.message };
          // Only the error itself is logged, never the arguments (they may contain journal text).
          log.error(`${namespace}.${method} failed`, err);
          return { ok: false, code: 'internal', message: INTERNAL_ERROR };
        }
      });
    }
  }
}
