/**
 * Small, readable charts. They show what was recorded and nothing more: no
 * scores, no trends drawn as judgments. Every chart has a text equivalent.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { DaySummary, MoodRecord, TrackerSummary } from '@core/api';
import { monthDays, parseDateKey, type DateKey, type MonthKey } from '@core/dates';
import { energyLabel } from '@core/moods';
import { SCALE_MAX } from '@core/trackers';
import { MoodIcon } from './MoodIcon';

/** Splits points into runs of neighbours, so lines never bridge days or months without data. */
function consecutiveRuns<T extends { i: number }>(points: T[]): T[][] {
  const runs: T[][] = [];
  for (const point of points) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === point.i - 1) last.push(point);
    else runs.push([point]);
  }
  return runs;
}

export function BarChart({
  data,
  label,
  unit,
}: {
  data: { key: string; label: string; value: number; title: string }[];
  label: string;
  unit: [singular: string, plural: string];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="chart bar-chart">
      <figcaption className="visually-hidden">{label}</figcaption>
      <ol className="bars">
        {data.map((d, i) => (
          <li
            key={d.key}
            className="bar-col"
            style={{ '--i': i } as CSSProperties}
            title={`${d.title}: ${d.value} ${d.value === 1 ? unit[0] : unit[1]}`}
          >
            <span className="bar-value numeric" aria-hidden="true">
              {d.value > 0 ? d.value : ''}
            </span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar" style={{ height: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="bar-label" aria-hidden="true">
              {d.label}
            </span>
            <span className="visually-hidden">
              {d.title}: {d.value} {d.value === 1 ? unit[0] : unit[1]}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function MoodBars({
  counts,
  moodFor,
  limit,
}: {
  counts: { mood: string; count: number }[];
  moodFor: (key: string) => MoodRecord | undefined;
  limit?: number;
}) {
  const total = counts.reduce((n, c) => n + c.count, 0);
  const max = Math.max(1, ...counts.map((c) => c.count));
  const shown = limit ? counts.slice(0, limit) : counts;
  return (
    <ul className="mood-bars">
      {shown.map(({ mood: key, count }, i) => {
        const mood = moodFor(key);
        const share = total ? Math.round((count / total) * 100) : 0;
        return (
          <li key={key} style={{ '--i': i } as CSSProperties}>
            <span className="mood-bars-label">
              {mood && <MoodIcon icon={mood.icon} color={mood.color} size={22} />}
              {mood?.label ?? key}
            </span>
            <span className="mood-bars-track" aria-hidden="true">
              <span
                className="mood-bars-fill"
                style={{ width: `${(count / max) * 100}%`, background: `var(--mood-${mood?.color ?? 'sand'})` }}
              />
            </span>
            <span className="mood-bars-count numeric">
              {count} <span className="muted">· {share}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Each day of a month with its recorded mood, plus recorded energy as a line underneath. */
export function MonthRibbon({
  month,
  days,
  moodFor,
  formatDay,
}: {
  month: MonthKey;
  days: DaySummary[];
  moodFor: (key: string | null) => MoodRecord | undefined;
  formatDay: (date: DateKey) => string;
}) {
  const all = monthDays(month);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const width = all.length * 28;
  const energyPoints = all
    .map((date, i) => ({ i, energy: byDate.get(date)?.energy ?? null }))
    .filter((p): p is { i: number; energy: number } => p.energy !== null);
  const x = (i: number) => i * 28 + 14;
  const y = (e: number) => 44 - ((e - 1) / 4) * 36;

  return (
    <figure className="chart month-ribbon">
      <figcaption className="visually-hidden">Mood and energy for each day of the month</figcaption>
      <div className="ribbon-scroll">
        <div className="ribbon" style={{ width }}>
          <ol className="ribbon-days">
            {all.map((date, i) => {
              const day = byDate.get(date);
              const mood = moodFor(day?.mood ?? null);
              const description = day
                ? [mood ? mood.label : null, day.energy ? `energy ${day.energy} of 5` : null].filter(Boolean).join(', ') || 'saved'
                : 'nothing saved';
              return (
                <li key={date} title={`${formatDay(date)}: ${description}`} style={{ '--i': i } as CSSProperties}>
                  <span className="visually-hidden">
                    {formatDay(date)}: {description}
                  </span>
                  <span className="ribbon-cell" aria-hidden="true">
                    {mood ? (
                      <MoodIcon icon={mood.icon} color={mood.color} size={22} />
                    ) : (
                      <span className={day ? 'ribbon-dot filled' : 'ribbon-dot'} />
                    )}
                  </span>
                  <span className="ribbon-num" aria-hidden="true">
                    {parseDateKey(date).day}
                  </span>
                </li>
              );
            })}
          </ol>
          {energyPoints.length > 0 && (
            <svg className="ribbon-energy" width={width} height="52" viewBox={`0 0 ${width} 52`} aria-hidden="true">
              {[1, 3, 5].map((e) => (
                <line key={e} x1="0" x2={width} y1={y(e)} y2={y(e)} className="ribbon-gridline" />
              ))}
              <g className="line-reveal">
                {consecutiveRuns(energyPoints)
                  .filter((run) => run.length > 1)
                  .map((run) => (
                    <polyline key={run[0].i} points={run.map((p) => `${x(p.i)},${y(p.energy)}`).join(' ')} className="ribbon-line" />
                  ))}
              </g>
              {energyPoints.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)}
                  cy={y(p.energy)}
                  r="3.4"
                  className="ribbon-point"
                  style={{ '--i': p.i } as CSSProperties}
                />
              ))}
            </svg>
          )}
        </div>
      </div>
      {energyPoints.length > 0 && (
        <p className="ribbon-legend" aria-hidden="true">
          <span className="ribbon-legend-line" /> Energy you recorded (1 – 5)
        </p>
      )}
    </figure>
  );
}

export interface MoodColumn {
  key: string;
  /** Under the bar, e.g. "Jan" or "Mon". */
  label: string;
  /** In full, for tooltips and the table, e.g. "January 2026" or "Monday". */
  title: string;
  total: number;
  counts: Record<string, number>;
}

/** Moods per column (months, weekdays…), stacked, with a table for screen readers. */
export function StackedMoodBars({
  columns,
  moods,
  caption,
  header,
}: {
  columns: MoodColumn[];
  moods: MoodRecord[];
  caption: string;
  /** The table's first column heading, e.g. "Month". */
  header: string;
}) {
  const max = Math.max(1, ...columns.map((c) => c.total));
  const used = moods.filter((mood) => columns.some((c) => c.counts[mood.key]));
  return (
    <figure className="chart stacked-chart">
      <ol className="bars">
        {columns.map((c, i) => (
          <li key={c.key} className="bar-col" style={{ '--i': i } as CSSProperties}>
            <span className="bar-value numeric" aria-hidden="true">
              {c.total > 0 ? c.total : ''}
            </span>
            <span className="bar-track" aria-hidden="true">
              <span className="stack" style={{ height: `${(c.total / max) * 100}%` }}>
                {used
                  .filter((mood) => c.counts[mood.key])
                  .map((mood) => (
                    <span
                      key={mood.key}
                      className="stack-part"
                      title={`${c.title}: ${mood.label} ×${c.counts[mood.key]}`}
                      style={{ flexGrow: c.counts[mood.key], background: `var(--mood-${mood.color})` }}
                    />
                  ))}
              </span>
            </span>
            <span className="bar-label" aria-hidden="true">
              {c.label}
            </span>
          </li>
        ))}
      </ol>
      {used.length > 0 && (
        <ul className="chart-legend" aria-hidden="true">
          {used.map((mood) => (
            <li key={mood.key}>
              <MoodIcon icon={mood.icon} color={mood.color} size={18} /> {mood.label}
            </li>
          ))}
        </ul>
      )}
      <table className="visually-hidden">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{header}</th>
            {used.map((mood) => (
              <th key={mood.key} scope="col">
                {mood.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.title}</th>
              {used.map((mood) => (
                <td key={mood.key}>{c.counts[mood.key] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Moods recorded per month, stacked. */
export function StackedMoodChart({
  months,
  moods,
  formatMonth,
}: {
  months: { month: MonthKey; total: number; counts: Record<string, number> }[];
  moods: MoodRecord[];
  formatMonth: (month: MonthKey, width: 'short' | 'long') => string;
}) {
  return (
    <StackedMoodBars
      caption="Moods recorded per month"
      header="Month"
      moods={moods}
      columns={months.map((m) => ({
        key: m.month,
        label: formatMonth(m.month, 'short'),
        title: formatMonth(m.month, 'long'),
        total: m.total,
        counts: m.counts,
      }))}
    />
  );
}

/** Horizontal bars with a label and a number, for averages and counts (the text says what each number is). */
export function LabeledBars({
  items,
  max,
  className,
}: {
  items: { key: string; label: ReactNode; value: number; text: string; color?: string }[];
  max?: number;
  className?: string;
}) {
  const top = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className={`mood-bars labeled-bars${className ? ` ${className}` : ''}`}>
      {items.map((item, i) => (
        <li key={item.key} style={{ '--i': i } as CSSProperties}>
          <span className="mood-bars-label">{item.label}</span>
          <span className="mood-bars-track" aria-hidden="true">
            <span
              className="mood-bars-fill"
              style={{ width: `${(item.value / top) * 100}%`, background: item.color ?? 'var(--lavender-300)' }}
            />
          </span>
          <span className="mood-bars-count numeric">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What was recorded for each tracker: the share of yes for a yes-or-no tracker, the average for a 1–5 one.
 * The text next to each bar says exactly what was counted.
 */
export function TrackerBars({ trackers }: { trackers: TrackerSummary[] }) {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  return (
    <LabeledBars
      max={1}
      className="tracker-bars"
      items={trackers.map((t) =>
        t.kind === 'check'
          ? {
              key: String(t.id),
              label: t.label,
              value: t.days ? t.yes / t.days : 0,
              text: `Yes on ${t.yes} of ${days(t.days)}`,
              color: 'var(--sage-300)',
            }
          : {
              key: String(t.id),
              label: t.label,
              value: (t.average ?? 0) / SCALE_MAX,
              text: `Average ${t.average} · ${days(t.days)}`,
              color: 'var(--lavender-300)',
            },
      )}
    />
  );
}

/** Average recorded energy per month on a 1–5 scale — or, with `scaleName`, the average of a 1–5 tracker. */
export function EnergyChart({
  months,
  formatMonth,
  scaleName,
}: {
  months: { month: MonthKey; average: number | null; days: number }[];
  formatMonth: (month: MonthKey, width: 'short' | 'long') => string;
  scaleName?: string;
}) {
  const width = 600;
  const height = 150;
  const step = width / months.length;
  const x = (i: number) => i * step + step / 2;
  const y = (v: number) => 14 + ((5 - v) / 4) * (height - 44);
  const points = months.map((m, i) => ({ ...m, i })).filter((m) => m.average !== null) as {
    month: MonthKey;
    average: number;
    days: number;
    i: number;
  }[];
  return (
    <figure className="chart energy-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((v) => (
          <line key={v} x1="0" x2={width} y1={y(v)} y2={y(v)} className="ribbon-gridline" />
        ))}
        <g className="line-reveal">
          {consecutiveRuns(points)
            .filter((run) => run.length > 1)
            .map((run) => (
              <polyline key={run[0].i} points={run.map((p) => `${x(p.i)},${y(p.average)}`).join(' ')} className="ribbon-line" />
            ))}
        </g>
      </svg>
      <ol className="energy-points">
        {months.map((m, i) => (
          <li key={m.month} style={{ left: `${(x(i) / width) * 100}%`, '--i': i } as CSSProperties}>
            {m.average !== null && (
              <span className="energy-dot" style={{ top: `${(y(m.average) / height) * 100}%` }} title={`${formatMonth(m.month, 'long')}: ${m.average} average over ${m.days} days`}>
                <span className="visually-hidden">
                  {scaleName
                    ? `${formatMonth(m.month, 'long')}: ${scaleName}, ${m.average} of 5 on average, from ${m.days} days`
                    : `${formatMonth(m.month, 'long')}: average energy ${m.average} of 5 (${energyLabel(Math.round(m.average))}), from ${m.days} days`}
                </span>
              </span>
            )}
            <span className="energy-month" aria-hidden="true">
              {formatMonth(m.month, 'short')}
            </span>
          </li>
        ))}
      </ol>
      <div className="energy-axis" aria-hidden="true">
        <span style={{ top: y(5) }}>{scaleName ? '5' : '5 · very high'}</span>
        <span style={{ top: y(3) }}>{scaleName ? '3' : '3 · steady'}</span>
        <span style={{ top: y(1) }}>{scaleName ? '1' : '1 · very low'}</span>
      </div>
    </figure>
  );
}

export function YearInMoodsGrid({
  days,
  moodFor,
  formatDay,
  formatMonth,
}: {
  days: { date: DateKey; mood: string | null; hasEntry: boolean }[];
  moodFor: (key: string | null) => MoodRecord | undefined;
  formatDay: (date: DateKey) => string;
  formatMonth: (month: MonthKey, width: 'short' | 'long') => string;
}) {
  const rows = new Map<string, typeof days>();
  for (const d of days) rows.set(d.date.slice(0, 7), [...(rows.get(d.date.slice(0, 7)) ?? []), d]);
  return (
    <figure className="chart year-grid" aria-label="Moods recorded on each day of the year">
      <div className="year-grid-scroll">
        <table>
          <tbody>
            {[...rows.entries()].map(([month, monthDaysList], i) => (
              <tr key={month} style={{ '--i': i } as CSSProperties}>
                <th scope="row">{formatMonth(month, 'short')}</th>
                {monthDaysList.map((d) => {
                  const mood = moodFor(d.mood);
                  const label = `${formatDay(d.date)}: ${mood ? mood.label : d.hasEntry ? 'saved, no mood' : 'nothing saved'}`;
                  return (
                    <td key={d.date} title={label}>
                      <span
                        className={`year-cell${mood ? ' has-mood' : d.hasEntry ? ' has-entry' : ''}`}
                        style={mood ? { background: `var(--mood-${mood.color})` } : undefined}
                        aria-label={label}
                        role="img"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
