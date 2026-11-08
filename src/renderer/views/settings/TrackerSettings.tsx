/**
 * Trackers: small things answered each day with yes or no, or on a 1–5 scale. A tracker with answers can be
 * put away (its answers stay) but not deleted; one without answers can be deleted.
 */
import { useState } from 'react';
import type { TrackerRecord } from '@core/api';
import {
  MAX_ACTIVE_TRACKERS,
  MAX_TRACKER_LABEL_LENGTH,
  TRACKER_SUGGESTIONS,
  trackerKindLabel,
  type TrackerKind,
} from '@core/trackers';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/data';
import { SettingsSection } from '../SettingsView';

const daysLabel = (n: number) => (n === 0 ? 'no answers yet' : n === 1 ? 'answered on 1 day' : `answered on ${n} days`);

export function TrackerSettings() {
  const trackers = useQuery('trackers', () => api.trackers.list(), ['trackers']);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<TrackerKind>('check');
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = trackers.data ?? [];
  const active = list.filter((t) => !t.archived);
  const putAway = list.filter((t) => t.archived);
  const full = active.length >= MAX_ACTIVE_TRACKERS;
  const suggestions = TRACKER_SUGGESTIONS.filter((s) => !list.some((t) => t.label.toLocaleLowerCase() === s.label.toLocaleLowerCase()));

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      invalidate('trackers', 'entries');
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const add = (label: string, k: TrackerKind) =>
    run(() => api.trackers.create({ label, kind: k })).then((ok) => {
      if (ok) setDraft('');
    });

  const move = (index: number, delta: number) => {
    const ids = active.map((t) => t.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => api.trackers.reorder(ids));
  };

  const remove = async (tracker: TrackerRecord) => {
    const ok = await confirm({
      title: `Delete “${tracker.label}”?`,
      body: 'It has no answers yet, so nothing else changes.',
      confirmLabel: 'Delete tracker',
      tone: 'danger',
    });
    if (ok) void run(() => api.trackers.remove(tracker.id));
  };

  const row = (tracker: TrackerRecord, index: number) => (
    <li key={tracker.id}>
      {editing?.id === tracker.id ? (
        <form
          className="inline-form grow"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.trackers.update(tracker.id, { label: editing.label })).then((ok) => ok && setEditing(null));
          }}
        >
          <input
            className="input"
            value={editing.label}
            maxLength={MAX_TRACKER_LABEL_LENGTH}
            autoFocus
            aria-label={`Rename “${tracker.label}”`}
            onChange={(event) => setEditing({ id: tracker.id, label: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setEditing(null);
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!editing.label.trim()}>
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="tag-settings-label">
            <strong>{tracker.label}</strong>
            <span className="muted">
              {trackerKindLabel(tracker.kind)} · {daysLabel(tracker.days)}
            </span>
          </span>
          {!tracker.archived && (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${tracker.label} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <Icon name="arrow-up" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${tracker.label} down`}
                disabled={index === active.length - 1}
                onClick={() => move(index, 1)}
              >
                <Icon name="arrow-down" size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Rename “${tracker.label}”`}
            title="Rename"
            onClick={() => setEditing({ id: tracker.id, label: tracker.label })}
          >
            <Icon name="pencil" size={16} />
          </button>
          {tracker.archived ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={full}
              title={full ? `Up to ${MAX_ACTIVE_TRACKERS} trackers can be on a day’s page` : undefined}
              onClick={() => void run(() => api.trackers.update(tracker.id, { archived: false }))}
            >
              <Icon name="restore" size={14} /> Bring back
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Take it off the day page. Its answers are kept."
              onClick={() => void run(() => api.trackers.update(tracker.id, { archived: true }))}
            >
              Put away
            </button>
          )}
          {tracker.days === 0 && (
            <button type="button" className="icon-btn" aria-label={`Delete “${tracker.label}”`} onClick={() => void remove(tracker)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </>
      )}
    </li>
  );

  return (
    <SettingsSection
      id="trackers"
      title="Trackers"
      description="Small things you’d like to keep an eye on — a walk, your medicine, how you slept. Each one is a quick yes or no, or a 1 to 5, next to your mood on every day’s page. Answer them when you like; a day without an answer is simply a day."
    >
      {active.length === 0 ? (
        <p className="muted">No trackers yet.</p>
      ) : (
        <ul className="tag-settings tracker-settings">{active.map(row)}</ul>
      )}
      <form
        className="inline-form tracker-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) void add(draft.trim(), kind);
        }}
      >
        <label className="visually-hidden" htmlFor="new-tracker">
          New tracker
        </label>
        <input
          id="new-tracker"
          className="input"
          value={draft}
          maxLength={MAX_TRACKER_LABEL_LENGTH}
          disabled={full}
          placeholder="Something to track, like “Went for a walk”…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="segmented" role="radiogroup" aria-label="Answered with">
          {(['check', 'scale'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={full} onClick={() => setKind(k)}>
              {trackerKindLabel(k)}
            </button>
          ))}
        </div>
        <button type="submit" className="btn" disabled={!draft.trim() || full}>
          <Icon name="plus" size={16} /> Add
        </button>
      </form>
      {full ? (
        <p className="muted">
          {MAX_ACTIVE_TRACKERS} trackers is the most a day’s page shows. Put one away to add another.
        </p>
      ) : (
        suggestions.length > 0 && (
          <p className="tracker-suggestions">
            <span className="muted">Ideas:</span>
            {suggestions.map((s) => (
              <button key={s.label} type="button" className="tag-chip tag-new" onClick={() => void add(s.label, s.kind)}>
                <Icon name="plus" size={13} /> {s.label} <span className="muted">· {trackerKindLabel(s.kind)}</span>
              </button>
            ))}
          </p>
        )
      )}

      {putAway.length > 0 && (
        <>
          <h3 className="sub-heading">Put away</h3>
          <p className="muted">Not on the day page any more. Their answers are kept, and still count in Insights.</p>
          <ul className="tag-settings tracker-settings">{putAway.map(row)}</ul>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
    </SettingsSection>
  );
}
