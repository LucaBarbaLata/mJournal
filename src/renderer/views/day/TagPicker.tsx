/**
 * Tags on the day page: the quick chips to tap, the day's other tags (#ones come from the writing and follow
 * it), and a small field for a new tag.
 */
import { useId, useState } from 'react';
import type { DayTag } from '@core/api';
import type { DateKey } from '@core/dates';
import { MAX_TAG_LENGTH } from '@core/tags';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/data';

export function TagPicker({ date, tags, onChange }: { date: DateKey; tags: DayTag[]; onChange: (tags: DayTag[]) => void }) {
  const vocabulary = useQuery('tags', () => api.tags.list(), ['tags']);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const listId = useId();

  const onDay = new Map(tags.map((t) => [t.name, t]));
  const quick = (vocabulary.data ?? []).filter((t) => t.quick);
  const quickNames = new Set(quick.map((t) => t.name));
  const others = tags.filter((t) => !quickNames.has(t.name));

  const set = async (label: string, picked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.entries.setTag(date, label, picked));
      invalidate('entries', 'tags');
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const label = draft.trim();
    if (!label) return;
    if (await set(label, true)) {
      setDraft('');
      setAdding(false);
    }
  };

  const fromWriting = (tag: DayTag) => tag.written && !tag.picked;

  return (
    <div className="tag-picker">
      <h3 className="field-label" id={titleId}>
        Tags <span className="muted">(optional)</span>
      </h3>
      <ul className="tag-list" aria-labelledby={titleId}>
        {quick.map((tag) => {
          const day = onDay.get(tag.name);
          const written = day ? fromWriting(day) : false;
          return (
            <li key={tag.name}>
              <button
                type="button"
                className={`tag-chip${written ? ' written' : ''}`}
                aria-pressed={Boolean(day)}
                disabled={busy || written}
                title={written ? `From #${tag.label} in your writing` : undefined}
                onClick={() => void set(tag.label, !day?.picked)}
              >
                {tag.label}
              </button>
            </li>
          );
        })}
        {others.map((tag) =>
          fromWriting(tag) ? (
            <li key={tag.name}>
              <span className="tag-chip written" title={`From #${tag.label} in your writing`}>
                #{tag.label}
              </span>
            </li>
          ) : (
            <li key={tag.name}>
              <button
                type="button"
                className="tag-chip"
                aria-pressed="true"
                disabled={busy}
                title={tag.written ? `Also written as #${tag.label}` : 'Remove this tag from the day'}
                onClick={() => void set(tag.label, false)}
              >
                {tag.label}
              </button>
            </li>
          ),
        )}
        <li>
          {adding ? (
            <form
              className="tag-add"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <label className="visually-hidden" htmlFor={`${listId}-input`}>
                New tag
              </label>
              <input
                id={`${listId}-input`}
                className="input tag-input"
                list={listId}
                value={draft}
                maxLength={MAX_TAG_LENGTH}
                autoFocus
                placeholder="A tag…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setAdding(false);
                    setDraft('');
                  }
                }}
              />
              <datalist id={listId}>
                {(vocabulary.data ?? [])
                  .filter((t) => !onDay.has(t.name))
                  .map((t) => (
                    <option key={t.name} value={t.label} />
                  ))}
              </datalist>
              <button type="submit" className="btn btn-sm" disabled={!draft.trim() || busy}>
                Add
              </button>
            </form>
          ) : (
            <button type="button" className="tag-chip tag-new" onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} /> Tag
            </button>
          )}
        </li>
      </ul>
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
