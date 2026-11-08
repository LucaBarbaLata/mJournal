/**
 * Trackers on the day page: each one answered with Yes / No or on a 1–5 scale. Clicking the chosen answer again
 * clears it. Trackers that were put away still show on the days that have an answer for them.
 */
import { useId, useRef } from 'react';
import type { DayTrackerValue, TrackerRecord } from '@core/api';
import type { DateKey } from '@core/dates';
import { SCALE_MAX, SCALE_MIN } from '@core/trackers';
import { rovingKeys } from '../../components/MoodPicker';
import { api } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/data';
import { saveQueue } from '../../lib/saveQueue';

const SCALE = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);
const CHECK = [
  { value: 1, label: 'Yes' },
  { value: 0, label: 'No' },
];

export function TrackerPicker({
  date,
  values,
  onChange,
}: {
  date: DateKey;
  values: DayTrackerValue[];
  onChange: (values: DayTrackerValue[]) => void;
}) {
  const trackers = useQuery('trackers', () => api.trackers.list(), ['trackers']);
  const titleId = useId();
  const answered = new Map(values.map((v) => [v.trackerId, v.value]));
  const shown = (trackers.data ?? []).filter((t) => !t.archived || answered.has(t.id));
  if (shown.length === 0) return null;

  const answer = (tracker: TrackerRecord, value: number | null) => {
    const next = values.filter((v) => v.trackerId !== tracker.id);
    if (value !== null) next.push({ trackerId: tracker.id, value });
    onChange(next);
    void saveQueue.saveNow(`tracker:${date}:${tracker.id}`, async () => {
      await api.trackers.setForDay(date, tracker.id, value);
      invalidate('entries', 'trackers');
    });
  };

  return (
    <div className="tracker-block">
      <h3 className="field-label" id={titleId}>
        Trackers <span className="muted">(optional)</span>
      </h3>
      <ul className="tracker-list" aria-labelledby={titleId}>
        {shown.map((tracker) => (
          <TrackerRow key={tracker.id} tracker={tracker} value={answered.get(tracker.id) ?? null} onAnswer={(v) => answer(tracker, v)} />
        ))}
      </ul>
    </div>
  );
}

function TrackerRow({
  tracker,
  value,
  onAnswer,
}: {
  tracker: TrackerRecord;
  value: number | null;
  onAnswer: (value: number | null) => void;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const options =
    tracker.kind === 'check'
      ? CHECK.map((o) => ({ ...o, aria: o.label }))
      : SCALE.map((n) => ({ value: n, label: String(n), aria: `${n} of ${SCALE_MAX}` }));
  const selected = options.findIndex((o) => o.value === value);
  const focusIndex = selected >= 0 ? selected : 0;

  return (
    <li className={`tracker-row ${tracker.kind}`}>
      <span className="tracker-label" id={labelId}>
        {tracker.label}
        {tracker.archived && <span className="muted"> · put away</span>}
      </span>
      <div className="tracker-choices" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option, i) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.aria}
              tabIndex={i === focusIndex ? 0 : -1}
              className={`tracker-choice${checked ? ' checked' : ''}${
                tracker.kind === 'scale' && value !== null && option.value <= value ? ' filled' : ''
              }`}
              title={checked ? 'Click again to clear' : undefined}
              onClick={() => onAnswer(checked ? null : option.value)}
              onKeyDown={(event) =>
                rovingKeys(event, options.length, i, (next) => {
                  refs.current[next]?.focus();
                  onAnswer(options[next].value);
                })
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}
