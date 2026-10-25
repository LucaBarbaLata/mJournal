/** App-wide state: settings, the mood vocabulary and helpers that depend on them. */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { AppInfo, MoodRecord, Settings } from '@core/api';
import {
  formatDayMonth,
  formatLongDate,
  formatMediumDate,
  formatMonthYear,
  formatShortDate,
  formatClockTime,
  type DateKey,
  type MonthKey,
} from '@core/dates';
import { api } from './api';
import { invalidate, useQuery } from './data';

export interface AppState {
  settings: Settings;
  moods: MoodRecord[];
  visibleMoods: MoodRecord[];
  mood: (key: string | null | undefined) => MoodRecord | undefined;
  info: AppInfo;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  format: {
    long: (date: DateKey) => string;
    medium: (date: DateKey) => string;
    short: (date: DateKey) => string;
    dayMonth: (date: DateKey) => string;
    monthYear: (month: MonthKey) => string;
    time: (iso: string) => string;
  };
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const settings = useQuery('settings', () => api.settings.get(), ['settings']);
  const moods = useQuery('moods', () => api.moods.list(), ['moods']);
  const info = useQuery('app-info', () => api.app.info());

  const current = settings.data;
  useEffect(() => {
    if (!current) return;
    const root = document.documentElement;
    root.dataset.writing = current.writingFont;
    root.classList.toggle('reduce-motion', current.reduceMotion);
  }, [current]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.settings.update(patch);
    invalidate('settings');
    return next;
  }, []);

  const value = useMemo<AppState | null>(() => {
    if (!settings.data || !moods.data || !info.data) return null;
    const s = settings.data;
    const byKey = new Map(moods.data.map((m) => [m.key, m]));
    return {
      settings: s,
      moods: moods.data,
      visibleMoods: moods.data.filter((m) => !m.hidden),
      mood: (key) => (key ? byKey.get(key) : undefined),
      info: info.data,
      updateSettings,
      format: {
        long: (date) => formatLongDate(date, s.dateFormat),
        medium: (date) => formatMediumDate(date, s.dateFormat),
        short: (date) => formatShortDate(date, s.dateFormat),
        dayMonth: (date) => formatDayMonth(date, s.dateFormat),
        monthYear: (month) => formatMonthYear(month),
        time: (iso) => formatClockTime(iso, s.dateFormat),
      },
    };
  }, [settings.data, moods.data, info.data, updateSettings]);

  if (!value) return <>{fallback}</>;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
