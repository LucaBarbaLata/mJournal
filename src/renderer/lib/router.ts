/** A small hash router: #/today, #/day/2026-10-24?q=walk, #/calendar/2026-10, #/journal?q=…, #/year/2026, … */
import { useSyncExternalStore } from 'react';
import { isDateKey, isMonthKey, type DateKey, type MonthKey } from '@core/dates';

export type Route =
  | { name: 'today' }
  | { name: 'day'; date: DateKey; query: string | null }
  | { name: 'calendar'; month: MonthKey | null; selected: DateKey | null }
  | { name: 'journal'; params: URLSearchParams }
  | { name: 'memories'; params: URLSearchParams }
  | { name: 'month'; month: MonthKey | null; query: string | null }
  | { name: 'year'; year: number | null; query: string | null }
  | { name: 'insights' }
  | { name: 'settings'; section: string | null };

export type RouteName = Route['name'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'day':
      return isDateKey(parts[1]) ? { name: 'day', date: parts[1], query: params.get('q') || null } : { name: 'today' };
    case 'calendar': {
      const selected = params.get('d');
      return {
        name: 'calendar',
        month: isMonthKey(parts[1]) ? parts[1] : null,
        selected: isDateKey(selected) ? selected : null,
      };
    }
    case 'journal':
      return { name: 'journal', params };
    case 'memories':
      return { name: 'memories', params };
    case 'month':
      return { name: 'month', month: isMonthKey(parts[1]) ? parts[1] : null, query: params.get('q') || null };
    case 'year':
      return { name: 'year', year: /^\d{4}$/.test(parts[1] ?? '') ? Number(parts[1]) : null, query: params.get('q') || null };
    case 'insights':
      return { name: 'insights' };
    case 'settings':
      return { name: 'settings', section: parts[1] ?? null };
    default:
      return { name: 'today' };
  }
}

const subscribe = (callback: () => void) => {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function useRoute(): Route {
  const hash = useHash();
  return parseHash(hash);
}

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = to;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = to;
  }
}

const query = (params: Record<string, string | undefined | null | false>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const href = {
  today: () => '#/today',
  /** A day's page; with `q`, the search's matches are highlighted on it. */
  day: (date: DateKey, q?: string | null) => `#/day/${date}${query({ q })}`,
  calendar: (month?: MonthKey, selected?: DateKey) => `#/calendar${month ? `/${month}` : ''}${query({ d: selected })}`,
  journal: (params: Record<string, string | undefined | null | false> = {}) => `#/journal${query(params)}`,
  memories: (params: Record<string, string | undefined | null | false> = {}) => `#/memories${query(params)}`,
  month: (month?: MonthKey, q?: string | null) => `#/month${month ? `/${month}` : ''}${query({ q })}`,
  year: (year?: number, q?: string | null) => `#/year${year ? `/${year}` : ''}${query({ q })}`,
  insights: () => '#/insights',
  settings: (section?: string) => `#/settings${section ? `/${section}` : ''}`,
};
