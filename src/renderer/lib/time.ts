/** The current calendar date, updated when the clock passes midnight. */
import { useEffect, useState } from 'react';
import { todayKey, type DateKey } from '@core/dates';

export function useToday(): DateKey {
  const [today, setToday] = useState(() => todayKey());
  useEffect(() => {
    const check = () => setToday((current) => (current === todayKey() ? current : todayKey()));
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
