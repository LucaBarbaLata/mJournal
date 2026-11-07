/**
 * From 15 December to 31 January, a gentle card on Today points to the year in review (of the year that is
 * ending, or just ended) once that year has a week of saved days. "Not now" puts it away for that year.
 */
import type { DateKey } from '@core/dates';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { useQuery } from '../lib/data';
import { href } from '../lib/router';
import { Icon } from './Icon';

/** The year whose review is suggested on `today`, if it's the season for it. */
export function reviewYear(today: DateKey): number | null {
  const year = Number(today.slice(0, 4));
  const monthDay = today.slice(5);
  if (monthDay >= '12-15') return year;
  if (monthDay <= '01-31') return year - 1;
  return null;
}

export function YearReviewCard({ today }: { today: DateKey }) {
  const { settings, updateSettings } = useApp();
  const year = reviewYear(today);
  const id = year ? `year-review-${year}` : '';
  const days = useQuery(
    `year-review-days:${year}`,
    () => (year ? api.journal.search({ from: `${year}-01-01`, to: `${year}-12-31`, limit: 1 }).then((page) => page.total) : Promise.resolve(0)),
    ['entries'],
  );
  if (!year || !settings.onboardingDone || settings.dismissedTips.includes(id) || (days.data ?? 0) < 7) return null;
  return (
    <aside className="tip year-review-card" aria-label="Year in review">
      <span className="tip-icon" aria-hidden="true">
        <Icon name="star" size={18} />
      </span>
      <div className="tip-body">
        <p>
          <strong>Your {year} in review is ready.</strong> A look back at the year’s moods, moments and photos — and a
          letter to yourself about it.
        </p>
        <div className="row-actions">
          <a className="btn btn-sm btn-primary" href={href.year(year)}>
            Open {year}
          </a>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void updateSettings({ dismissedTips: [...new Set([...settings.dismissedTips, id])].slice(-50) }).catch(() => undefined)}
          >
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}
