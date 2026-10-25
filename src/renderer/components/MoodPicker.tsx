/** Mood and energy pickers. Both are radio groups: one Tab stop, arrow keys to move. */
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { MoodRecord } from '@core/api';
import { ENERGY_LEVELS } from '@core/moods';
import { burst } from '../lib/motion';
import { MoodIcon } from './MoodIcon';

function rovingKeys(event: KeyboardEvent<HTMLElement>, count: number, index: number, select: (i: number) => void) {
  const forward = ['ArrowRight', 'ArrowDown'];
  const backward = ['ArrowLeft', 'ArrowUp'];
  let next = -1;
  if (forward.includes(event.key)) next = (index + 1) % count;
  else if (backward.includes(event.key)) next = (index - 1 + count) % count;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  if (next < 0) return;
  event.preventDefault();
  select(next);
}

interface MoodPickerProps {
  moods: MoodRecord[];
  value: string | null;
  onChange: (key: string | null) => void;
  disabled?: boolean;
}

export function MoodPicker({ moods, value, onChange, disabled }: MoodPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = moods.findIndex((m) => m.key === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div className="mood-picker">
      <div className="mood-grid" role="radiogroup" aria-label="Mood">
        {moods.map((mood, i) => {
          const checked = mood.key === value;
          return (
            <button
              key={mood.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled}
              className={`mood-chip${checked ? ' checked' : ''}`}
              style={{ '--chip-color': `var(--mood-${mood.color})` } as CSSProperties}
              onClick={(event) => {
                if (!checked) {
                  burst(event.currentTarget.querySelector('.mood-chip-icon'), {
                    colors: [`var(--mood-${mood.color})`, 'var(--gold-300)', `var(--mood-${mood.color})`],
                    count: 10,
                    distance: 30,
                  });
                }
                onChange(checked ? null : mood.key);
              }}
              onKeyDown={(event) =>
                rovingKeys(event, moods.length, i, (next) => {
                  refs.current[next]?.focus();
                  onChange(moods[next].key);
                })
              }
            >
              <MoodIcon icon={mood.icon} color={mood.color} size={30} className="mood-chip-icon" />
              <span className="mood-chip-label">{mood.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface EnergyPickerProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function EnergyPicker({ value, onChange, disabled }: EnergyPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = value ? value - 1 : 2;
  const current = ENERGY_LEVELS.find((l) => l.value === value);
  return (
    <div className="energy-picker">
      <div className="energy-scale" role="radiogroup" aria-label="Energy, from 1 (very low) to 5 (very high)">
        {ENERGY_LEVELS.map((level, i) => {
          const checked = level.value === value;
          const filled = value !== null && level.value <= value;
          return (
            <button
              key={level.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${level.value} of 5: ${level.label}, ${level.description.toLowerCase()}`}
              title={`${level.label} — ${level.description}`}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled}
              className={`energy-step${filled ? ' filled' : ''}${checked ? ' checked' : ''}`}
              onClick={() => onChange(checked ? null : level.value)}
              onKeyDown={(event) =>
                rovingKeys(event, ENERGY_LEVELS.length, i, (next) => {
                  refs.current[next]?.focus();
                  onChange(ENERGY_LEVELS[next].value);
                })
              }
            >
              <span className="energy-bar" style={{ height: `${8 + i * 4}px`, '--i': i } as CSSProperties} aria-hidden="true" />
              <span className="energy-number" aria-hidden="true">
                {level.value}
              </span>
            </button>
          );
        })}
      </div>
      <p className="energy-caption" aria-hidden="true">
        {current ? (
          <>
            <strong>{current.label}</strong> · {current.description}
          </>
        ) : (
          <span className="muted">Not recorded</span>
        )}
      </p>
    </div>
  );
}
