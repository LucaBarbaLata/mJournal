/** Gentle statistics. Streaks are a small encouragement, never a scoreboard. */
import { useState } from 'react';
import type { StatsRange } from '@core/api';
import { formatMonthName, type MonthKey } from '@core/dates';
import { BarChart, EnergyChart, MoodBars, StackedMoodChart, YearInMoodsGrid } from '../components/Charts';
import { CountUp } from '../components/CountUp';
import { Sparkles } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { Tip } from '../components/Tip';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useQuery } from '../lib/data';
import { href } from '../lib/router';
import { useToday } from '../lib/time';
import './insights.css';

const RANGES: { key: StatsRange; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: '3 months' },
  { key: 'year', label: '12 months' },
  { key: 'all', label: 'All time' },
];

const monthLabel = (month: MonthKey, width: 'short' | 'long') =>
  width === 'long' ? `${formatMonthName(month)} ${month.slice(0, 4)}` : formatMonthName(month, 'short');

export function InsightsView() {
  const today = useToday();
  const { settings, format, moods, mood: moodFor } = useApp();
  const [range, setRange] = useState<StatsRange>('quarter');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const stats = useQuery(`stats:${today}:${range}`, () => api.stats.overview(today, range), ['entries']);
  const yearData = useQuery(`year:${year}`, () => api.stats.yearInMoods(year), ['entries']);
  const s = stats.data;

  if (stats.error) {
    return (
      <div className="page">
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{errorMessage(stats.error)}</span>
        </p>
      </div>
    );
  }
  if (!s) return <div className="page" aria-busy="true" />;

  const firstYear = s.firstEntryDate ? Number(s.firstEntryDate.slice(0, 4)) : year;

  return (
    <div className="page insights-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Insights</p>
          <h1>Gentle numbers</h1>
          <p className="subtitle muted">A quiet look at what you’ve recorded. Days without an entry are simply days.</p>
        </div>
      </header>

      {s.totalEntries === 0 ? (
        <div className="card empty">
          <div className="art">
            <Sparkles size={64} />
          </div>
          <h2>Your insights will grow with your journal</h2>
          <p>Once you’ve saved a few days — even just a mood — you’ll find gentle patterns here.</p>
          <a className="btn btn-primary" href={href.today()}>
            Go to today
          </a>
        </div>
      ) : (
        <>
          <Tip id="insights" icon="sprout">
            <strong>Tip:</strong> these are gentle numbers, never a scoreboard. You can hide the streak any time in Settings →
            Streaks &amp; reminder.
          </Tip>
          <dl className="tiles stagger">
            {settings.showStreaks && (
              <>
                <div className="tile tile-sage">
                  <dt>
                    <Icon name="sprout" size={16} /> Current streak
                  </dt>
                  <dd>
                    <span className="tile-number numeric">
                      <CountUp value={s.streak.current} />
                    </span>{' '}
                    {s.streak.current === 1 ? 'day' : 'days'}
                  </dd>
                  <p className="tile-note">
                    {s.streak.current >= 2
                      ? `Since ${format.dayMonth(s.streak.currentStart!)}`
                      : s.streak.current === 1
                        ? 'A lovely start'
                        : 'Every day is a fresh page'}
                  </p>
                </div>
                <div className="tile tile-lavender">
                  <dt>
                    <Icon name="star" size={16} /> Longest streak
                  </dt>
                  <dd>
                    <span className="tile-number numeric">
                      <CountUp value={s.streak.longest} />
                    </span>{' '}
                    {s.streak.longest === 1 ? 'day' : 'days'}
                  </dd>
                  {s.streak.longestStart && s.streak.longestEnd && (
                    <p className="tile-note">
                      {s.streak.longestStart === s.streak.longestEnd
                        ? format.medium(s.streak.longestStart)
                        : `${format.short(s.streak.longestStart)} – ${format.medium(s.streak.longestEnd)}`}
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="tile tile-rose">
              <dt>
                <Icon name="journal" size={16} /> Days journaled
              </dt>
              <dd>
                <span className="tile-number numeric">
                  <CountUp value={s.totalEntries} />
                </span>{' '}
                in total
              </dd>
              {s.firstEntryDate && <p className="tile-note">Since {format.medium(s.firstEntryDate)}</p>}
            </div>
            <div className="tile tile-peach">
              <dt>
                <Icon name="calendar" size={16} /> This month
              </dt>
              <dd>
                <span className="tile-number numeric">
                  <CountUp value={s.daysThisMonth} />
                </span>{' '}
                {s.daysThisMonth === 1 ? 'day' : 'days'}
              </dd>
              <p className="tile-note">
                {s.totalWords.toLocaleString('en')} words · {s.totalPhotos} photos overall
              </p>
            </div>
          </dl>

          <div className="insight-grid stagger">
            <section className="card" aria-labelledby="per-month">
              <div className="card-title">
                <h2 id="per-month">Days journaled per month</h2>
              </div>
              <BarChart
                label="Days journaled in each of the last 12 months"
                unit={['day', 'days']}
                data={s.entriesPerMonth.map((m) => ({
                  key: m.month,
                  label: monthLabel(m.month, 'short'),
                  value: m.count,
                  title: monthLabel(m.month, 'long'),
                }))}
              />
            </section>

            <section className="card" aria-labelledby="distribution">
              <div className="card-title">
                <h2 id="distribution">Moods recorded</h2>
                <span className="spacer" />
              </div>
              <div className="segmented range-switch" role="radiogroup" aria-label="Period">
                {RANGES.map((r) => (
                  <button key={r.key} type="button" role="radio" aria-checked={range === r.key} onClick={() => setRange(r.key)}>
                    {r.label}
                  </button>
                ))}
              </div>
              {s.moodDistribution.total === 0 ? (
                <p className="muted chart-empty">No moods recorded in this period.</p>
              ) : (
                <MoodBars counts={s.moodDistribution.counts} moodFor={(k) => moodFor(k)} />
              )}
            </section>

            <section className="card wide" aria-labelledby="mood-history">
              <div className="card-title">
                <h2 id="mood-history">Mood history</h2>
                <span className="spacer" />
                <span className="muted card-hint">Last 12 months</span>
              </div>
              <StackedMoodChart months={s.moodByMonth} moods={moods} formatMonth={monthLabel} />
            </section>

            <section className="card wide" aria-labelledby="energy-history">
              <div className="card-title">
                <h2 id="energy-history">Average energy</h2>
                <span className="spacer" />
                <span className="muted card-hint">Per month, from the days you recorded it</span>
              </div>
              {s.energyByMonth.every((m) => m.average === null) ? (
                <p className="muted chart-empty">No energy recorded in the last 12 months.</p>
              ) : (
                <EnergyChart months={s.energyByMonth} formatMonth={monthLabel} />
              )}
            </section>

            <section className="card wide" aria-labelledby="year-moods">
              <div className="card-title">
                <h2 id="year-moods">A year in moods</h2>
                <span className="spacer" />
                <div className="year-switch">
                  <button type="button" className="icon-btn" aria-label="Previous year" disabled={year <= firstYear} onClick={() => setYear(year - 1)}>
                    <Icon name="chevron-left" size={18} />
                  </button>
                  <strong className="numeric">{year}</strong>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Next year"
                    disabled={year >= Number(today.slice(0, 4))}
                    onClick={() => setYear(year + 1)}
                  >
                    <Icon name="chevron-right" size={18} />
                  </button>
                </div>
              </div>
              {yearData.data && (
                <YearInMoodsGrid days={yearData.data.days} moodFor={(k) => moodFor(k)} formatDay={format.long} formatMonth={monthLabel} />
              )}
              <p className="muted card-hint">Each square is a day, colored by the mood you recorded. Hover a square for details.</p>
            </section>
          </div>

          <details className="how-counted">
            <summary>
              <Icon name="info" size={16} /> How these numbers are counted
            </summary>
            <ul>
              <li>A day counts as journaled when you saved anything for it: a mood, energy, some words or a photo.</li>
              <li>
                Your current streak is the number of days in a row up to today. If you haven’t written today yet, a streak that
                ended yesterday still counts — the day isn’t over.
              </li>
              <li>A missed day is simply a day without an entry. Nothing is lost, and there are no points or penalties.</li>
              <li>Moods and energy are shown exactly as you recorded them. mJournal never guesses how you felt.</li>
              {!settings.showStreaks && <li>Streaks are hidden — you can show them again in Settings.</li>}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
