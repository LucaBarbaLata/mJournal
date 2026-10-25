/** Typed access to the main process. Failed calls reject with ApiError carrying a friendly message. */
import { API_METHODS, type IpcEnvelope, type MJournalApi, type NativeBridge } from '@core/api';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildApi(): MJournalApi {
  const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [namespace, methods] of Object.entries(API_METHODS)) {
    api[namespace] = {};
    for (const method of methods) {
      api[namespace][method] = async (...args: unknown[]) => {
        const call = window.mjournalIpc?.[namespace]?.[method];
        if (!call) throw new ApiError('unavailable', 'mJournal could not reach its storage. Please restart the app.');
        const envelope = (await call(...args)) as IpcEnvelope<unknown>;
        if (!envelope.ok) throw new ApiError(envelope.code, envelope.message);
        return envelope.value;
      };
    }
  }
  return api as unknown as MJournalApi;
}

export const api = buildApi();

const noop = () => () => undefined;
export const native: NativeBridge = window.mjournalNative ?? {
  pathForFile: () => '',
  onFlushRequest: noop,
  onNavigate: noop,
  onUpdateStatus: noop,
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
