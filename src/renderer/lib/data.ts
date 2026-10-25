/**
 * Data loading for views. useQuery fetches through the API and refetches
 * whenever one of its tags is invalidated after a change elsewhere.
 *
 * Tags: 'entries' (any day content), 'photos', 'prompts', 'moods',
 * 'settings', 'reflections', 'data' (backups, storage info).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Listener = (tags: ReadonlySet<string>) => void;
const listeners = new Set<Listener>();

export function invalidate(...tags: string[]): void {
  const set = new Set(tags);
  for (const listener of [...listeners]) listener(set);
}

export interface QueryState<T> {
  data: T | undefined;
  /** The key the current `data` belongs to (it may lag behind while a new key loads). */
  dataKey: string | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, tags: readonly string[] = []): QueryState<T> {
  const [state, setState] = useState<{ data: T | undefined; dataKey: string | null; error: unknown; loading: boolean }>({
    data: undefined,
    dataKey: null,
    error: null,
    loading: true,
  });
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetcherRef.current().then(
      (data) => alive && setState({ data, dataKey: key, error: null, loading: false }),
      (error: unknown) => alive && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [key, version]);

  const tagKey = tags.join('|');
  useEffect(() => {
    if (!tagKey) return;
    const wanted = tagKey.split('|');
    const listener: Listener = (changed) => {
      if (wanted.some((tag) => changed.has(tag))) setVersion((v) => v + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [tagKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
