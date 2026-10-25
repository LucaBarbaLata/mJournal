/** The update check's status, kept current by the main process. */
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@core/updates';
import { api, native } from './api';

export function useUpdateStatus(): [UpdateStatus | null, (status: UpdateStatus) => void] {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const unsubscribe = native.onUpdateStatus((next) => alive && setStatus(next));
    // An event that arrives first is newer than this answer.
    api.updates.status().then(
      (first) => alive && setStatus((current) => current ?? first),
      () => undefined,
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return [status, setStatus];
}
