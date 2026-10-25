/** The monthly calendar with a preview of the selected day. Empty days stay neutral. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { DaySummary } from '@core/api';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatMonthName,
  makeDateKey,
  makeMonthKey,
  monthGrid,
  monthOf,
  parseDateKey,
  parseMonthKey,
  weekday,
  weekdayNames,
  type DateKey,
  type MonthKey,
} from '@core/dates';
import { energyLabel } from '@core/moods';
import { JournalArt } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { MoodIcon } from '../components/MoodIcon';
import { PhotoImage, photoAlt } from '../components/Photo';
import { Tip } from '../components/Tip';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { useQuery } from '../lib/data';
import { slideClass, type NavDirection } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { ensureThumbnails } from '../lib/thumbnails';
import { useToday } from '../lib/time';
import './calendar.css';

export function CalendarView({ month: routeMonth, selected: routeSelected }: { month: MonthKey | null; selected: DateKey | null }) {
  const today = useToday();
  const { format, settings } = useApp();
  const month = routeMonth ?? monthOf(routeSelected ?? today);
  const selected = routeSelected ?? (monthOf(today) === month ? today : null);
  const summaries = useQuery(`month:${month}`, () => api.entries.month(month), ['entries']);
  const byDate = useMemo(
    () => new Map((summaries.dataKey === `month:${month}` ? summaries.data ?? [] : []).map((d) => [d.date, d])),
    [summaries.data, summaries.dataKey, month],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [slide, setSlide] = useState<NavDirection>(null);

  const go = (nextMonth: MonthKey, nextSelected?: DateKey) => {
    if (nextMonth !== month) setSlide(nextMonth > month ? 'forward' : 'back');
    navigate(href.calendar(nextMonth, nextSelected), { replace: true });
  };
  const select = (date: DateKey) => go(monthOf(date), date);
  const count = byDate.size;

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Calendar</p>
          <div className="month-title-row">
            <button
              type="button"
              className="month-title"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)}
            >
              <h1>{format.monthYear(month)}</h1>
              <Icon name="chevron-down" size={20} />
            </button>
            {pickerOpen && (
              <MonthPicker
                month={month}
                today={today}
                onPick={(m) => {
                  setPickerOpen(false);
                  go(m);
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
          <p className="subtitle muted">
            {count === 0 ? 'A fresh month of pages.' : `${count} ${count === 1 ? 'day' : 'days'} with something saved`}
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="icon-btn bordered nudge-left"
            onClick={() => go(addMonths(month, -1))}
            aria-label="Previous month"
            title="Previous month (Page Up)"
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="icon-btn bordered nudge-right"
            onClick={() => go(addMonths(month, 1))}
            aria-label="Next month"
            title="Next month (Page Down)"
          >
            <Icon name="chevron-right" />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => go(monthOf(today), today)}>
            Today
          </button>
        </div>
      </header>

      <Tip id="calendar" icon="calendar">
        <strong>Tip:</strong> days with something saved show their mood. Use the arrow keys to move between days and{' '}
        <strong>Page Up / Page Down</strong> to change the month. Days without an entry simply stay plain.
      </Tip>

      <div className="calendar-layout">
        <div className="card calendar-card">
          <MonthGrid
            key={month}
            slide={slide}
            month={month}
            today={today}
            selected={selected}
            weekStartsOn={settings.weekStartsOn}
            byDate={byDate}
            onSelect={select}
            onOpen={(date) => navigate(href.day(date))}
          />
          <ul className="calendar-legend" aria-label="Legend">
            <li>
              <span className="legend-today" aria-hidden="true">
                1
              </span>
              Today
            </li>
            <li>
              <Icon name="pen" size={14} /> Writing
            </li>
            <li>
              <Icon name="memories" size={14} /> Photos
            </li>
            <li>
              <Icon name="heart" size={14} filled /> Favorite
            </li>
          </ul>
        </div>
        {selected ? (
          <DayPreview key={selected} date={selected} today={today} />
        ) : (
          <aside className="card day-preview muted">Choose a day to see what you saved.</aside>
        )}
      </div>
    </div>
  );
}

function describe(summary: DaySummary | undefined, moodLabel: string | undefined): string {
  if (!summary) return 'nothing saved';
  const parts: string[] = [];
  if (moodLabel) parts.push(`mood: ${moodLabel}`);
  if (summary.energy) parts.push(`energy ${summary.energy} of 5`);
  if (summary.hasWriting) parts.push(`${summary.wordCount} words`);
  if (summary.photoCount) parts.push(`${summary.photoCount} ${summary.photoCount === 1 ? 'photo' : 'photos'}`);
  if (summary.favorite) parts.push('favorite');
  return parts.length ? parts.join(', ') : 'saved';
}

interface MonthGridProps {
  slide: NavDirection;
  month: MonthKey;
  today: DateKey;
  selected: DateKey | null;
  weekStartsOn: 0 | 1 | 6;
  byDate: Map<DateKey, DaySummary>;
  onSelect: (date: DateKey) => void;
  onOpen: (date: DateKey) => void;
}

/**
 * Set when the keyboard moves the selection. It lives outside the component
 * because moving into another month re-creates the grid (for the slide).
 */
let focusAfterMove = false;

function MonthGrid({ slide, month, today, selected, weekStartsOn, byDate, onSelect, onOpen }: MonthGridProps) {
  const { format, mood: moodFor } = useApp();
  const weeks = monthGrid(month, weekStartsOn);
  const names = weekdayNames(weekStartsOn, 'short');
  const longNames = weekdayNames(weekStartsOn, 'long');
  const focusDate = selected && monthOf(selected) === month ? selected : `${month}-01`;
  const gridRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (!focusAfterMove) return;
    focusAfterMove = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus({ preventScroll: true });
  }, [focusDate]);

  const onKeyDown = (event: KeyboardEvent, date: DateKey) => {
    const moves: Record<string, () => DateKey> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      PageUp: () => shiftMonth(date, -1),
      PageDown: () => shiftMonth(date, 1),
      Home: () => addDays(date, -((weekday(date) - weekStartsOn + 7) % 7)),
      End: () => addDays(date, 6 - ((weekday(date) - weekStartsOn + 7) % 7)),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      focusAfterMove = true;
      onSelect(move());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(date);
    }
  };

  return (
    <table className={`month-grid ${slideClass(slide)}`} role="grid" aria-label={format.monthYear(month)} ref={gridRef}>
      <thead>
        <tr>
          {names.map((name, i) => (
            <th key={name} scope="col" abbr={longNames[i]}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]}>
            {week.map((date) => {
              const summary = byDate.get(date);
              const mood = moodFor(summary?.mood);
              const outside = monthOf(date) !== month;
              const isToday = date === today;
              const isSelected = date === selected;
              const future = date > today;
              const classes = [
                'cal-day',
                outside && 'outside',
                isToday && 'today',
                isSelected && 'selected',
                summary && 'has-entry',
                future && 'future',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <td key={date} role="gridcell" aria-selected={isSelected}>
                  <button
                    type="button"
                    className={classes}
                    data-date={date}
                    tabIndex={date === focusDate ? 0 : -1}
                    aria-label={`${format.long(date)}${isToday ? ', today' : ''}: ${describe(summary, mood?.label)}`}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onSelect(date)}
                    onDoubleClick={() => onOpen(date)}
                    onKeyDown={(event) => onKeyDown(event, date)}
                  >
                    <span className="cal-num" aria-hidden="true">
                      {parseDateKey(date).day}
                    </span>
                    {mood && <MoodIcon icon={mood.icon} color={mood.color} size={26} className="cal-mood" />}
                    {!mood && summary && <span className="cal-dot" aria-hidden="true" />}
                    <span className="cal-marks" aria-hidden="true">
                      {summary?.hasWriting && <Icon name="pen" size={12} />}
                      {summary && summary.photoCount > 0 && <Icon name="memories" size={12} />}
                      {summary?.favorite && <Icon name="heart" size={12} filled />}
                    </span>
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same day of the month, `delta` months away (clamped to the month's length). */
function shiftMonth(date: DateKey, delta: number): DateKey {
  const { day } = parseDateKey(date);
  const target = addMonths(monthOf(date), delta);
  const { year, month } = parseMonthKey(target);
  return makeDateKey(year, month, Math.min(day, daysInMonth(year, month)));
}

function MonthPicker({
  month,
  today,
  onPick,
  onClose,
}: {
  month: MonthKey;
  today: DateKey;
  onPick: (month: MonthKey) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(parseMonthKey(month).year);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-current="true"], button')?.focus();
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const current = monthOf(today);
  return (
    <div
      className="popover month-picker"
      role="dialog"
      aria-label="Jump to a month"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="month-picker-year">
        <button type="button" className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Previous year">
          <Icon name="chevron-left" />
        </button>
        <strong className="numeric">{year}</strong>
        <button type="button" className="icon-btn" onClick={() => setYear(year + 1)} aria-label="Next year">
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="month-picker-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const key = makeMonthKey(year, i + 1);
          return (
            <button
              key={key}
              type="button"
              className={`month-picker-item${key === current ? ' is-current' : ''}`}
              aria-current={key === month ? 'true' : undefined}
              onClick={() => onPick(key)}
            >
              {formatMonthName(key, 'short')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayPreview({ date, today }: { date: DateKey; today: DateKey }) {
  const { format, mood: moodFor } = useApp();
  const day = useQuery(`preview:${date}`, () => api.entries.getDay(date), ['entries', 'photos']);
  const data = day.dataKey === `preview:${date}` ? day.data : undefined;
  useEffect(() => {
    if (data) ensureThumbnails(data.photos);
  }, [data]);

  const entry = data?.entry;
  const answers = data?.answers.filter((a) => a.answer.trim()) ?? [];
  const photos = data?.photos ?? [];
  const hasContent =
    !!entry && (entry.body.trim() || entry.mood || entry.energy || entry.moodNote.trim() || answers.length > 0 || photos.length > 0);
  const mood = moodFor(entry?.mood);

  return (
    <aside className="card day-preview" aria-labelledby="preview-title" aria-live="polite">
      <p className="eyebrow">{date === today ? 'Today' : 'Selected day'}</p>
      <h2 id="preview-title">{format.long(date)}</h2>
      {!data ? null : !hasContent ? (
        <div className="preview-empty">
          <JournalArt size={110} />
          <p className="muted">{date > today ? 'This day hasn’t happened yet.' : 'Nothing saved for this day.'}</p>
          {date <= today && (
            <a className="btn" href={href.day(date)}>
              <Icon name="pen" size={16} /> Write about this day
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="preview-meta">
            {mood && (
              <span className="chip">
                <MoodIcon icon={mood.icon} color={mood.color} size={18} /> {mood.label}
              </span>
            )}
            {entry?.energy && <span className="chip">Energy {entry.energy}/5 · {energyLabel(entry.energy)}</span>}
            {entry?.favorite && (
              <span className="chip soft-rose">
                <Icon name="heart" size={13} filled /> Favorite
              </span>
            )}
          </div>
          {entry?.moodNote.trim() && <p className="preview-note">“{entry.moodNote.trim()}”</p>}
          {entry?.body.trim() && <p className="preview-body">{entry.body.trim().slice(0, 420)}{entry.body.trim().length > 420 ? '…' : ''}</p>}
          {answers.length > 0 && (
            <ul className="preview-answers">
              {answers.slice(0, 3).map((a) => (
                <li key={a.promptId}>
                  <span className="preview-q">{a.promptText}</span>
                  <span className="preview-a">{a.answer.trim().slice(0, 160)}{a.answer.trim().length > 160 ? '…' : ''}</span>
                </li>
              ))}
              {answers.length > 3 && <li className="muted">and {answers.length - 3} more answers</li>}
            </ul>
          )}
          {photos.length > 0 && (
            <ul className="preview-photos" aria-label="Photos">
              {photos.slice(0, 6).map((photo) => (
                <li key={photo.id}>
                  <PhotoImage photo={photo} alt={photoAlt(photo, format.long(date))} />
                </li>
              ))}
            </ul>
          )}
          <a className="btn btn-primary" href={href.day(date)}>
            Open this day <Icon name="chevron-right" size={16} />
          </a>
        </>
      )}
    </aside>
  );
}
