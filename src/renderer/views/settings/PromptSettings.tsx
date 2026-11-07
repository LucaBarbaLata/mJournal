/** Questions asked every day, custom questions, favorite questions and hidden questions. */
import { useState } from 'react';
import type { PromptInfo } from '@core/api';
import { weekdayNames, weekdayOrder } from '@core/dates';
import { EVERY_WEEKDAY, MAX_PROMPT_LENGTH } from '@core/prompts';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { SettingsSection } from '../SettingsView';

/** Up to this many questions can be asked every day (the main process checks it too). */
const MAX_PINNED = 3;

/** Seven toggles, in the order of the person's week; at least one stays on. */
function WeekdayChips({ value, onChange }: { value: number; onChange: (weekdays: number) => void }) {
  const { settings } = useApp();
  const order = weekdayOrder(settings.weekStartsOn);
  const short = weekdayNames(settings.weekStartsOn, 'short');
  const long = weekdayNames(settings.weekStartsOn, 'long');
  return (
    <span className="weekday-chips" role="group" aria-label="Days of the week">
      {order.map((day, i) => {
        const on = Boolean((value >> day) & 1);
        return (
          <button
            key={day}
            type="button"
            className="weekday-chip"
            aria-pressed={on}
            aria-label={long[i]}
            title={long[i]}
            disabled={on && value === 1 << day}
            onClick={() => onChange(value ^ (1 << day))}
          >
            {short[i].slice(0, 2)}
          </button>
        );
      })}
    </span>
  );
}

export function PromptSettings() {
  const library = useQuery('prompt-library', () => api.prompts.library(), ['prompts']);
  const pinnedQuery = useQuery('pinned-prompts', () => api.prompts.pinned(), ['prompts']);
  const pinned = pinnedQuery.data ?? [];
  const pinnedIds = new Set(pinned.map((p) => p.promptId));
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prompts = library.data ?? [];
  const custom = prompts.filter((p) => p.custom);
  const favorites = prompts.filter((p) => p.favorite);
  const hidden = prompts.filter((p) => p.hidden);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      invalidate('prompts');
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  /** "Ask every day" for a prompt in the lists below. */
  const AskEveryDay = ({ prompt }: { prompt: PromptInfo }) =>
    pinnedIds.has(prompt.id) ? (
      <span className="muted asked-daily">
        <Icon name="pin" size={14} /> Asked every day
      </span>
    ) : (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pinned.length >= MAX_PINNED}
        title={pinned.length >= MAX_PINNED ? `Up to ${MAX_PINNED} questions can be asked every day` : undefined}
        onClick={() => void run(() => api.prompts.setPinned(prompt.id, EVERY_WEEKDAY))}
      >
        <Icon name="pin" size={14} /> Ask every day
      </button>
    );

  const archive = async (prompt: PromptInfo) => {
    const ok = await confirm({
      title: 'Remove this prompt?',
      body: 'It won’t be suggested any more. Answers you already wrote keep their question.',
      confirmLabel: 'Remove prompt',
    });
    if (ok) void run(() => api.prompts.archiveCustom(prompt.id));
  };

  return (
    <SettingsSection
      id="prompts"
      title="Prompts"
      description={`mJournal has ${prompts.filter((p) => !p.custom).length} built-in questions. Add your own, keep favorites, or hide ones that don’t fit.`}
    >
      <h3 className="sub-heading">Asked every day</h3>
      {pinned.length === 0 ? (
        <p className="muted">
          None yet. Tap the pin on a question on Today’s page, or “Ask every day” below — up to {MAX_PINNED} questions,
          on the days of the week you choose.
        </p>
      ) : (
        <ul className="prompt-settings">
          {pinned.map((p) => (
            <li key={p.promptId}>
              <span className="prompt-settings-text">{p.text}</span>
              <WeekdayChips value={p.weekdays} onChange={(weekdays) => void run(() => api.prompts.setPinned(p.promptId, weekdays))} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => api.prompts.setPinned(p.promptId, null))}>
                Stop asking
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub-heading">My prompts</h3>
      {custom.length === 0 ? (
        <p className="muted">No custom prompts yet.</p>
      ) : (
        <ul className="prompt-settings">
          {custom.map((p) => (
            <li key={p.id}>
              {editing?.id === p.id ? (
                <form
                  className="inline-form grow"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => api.prompts.updateCustom(p.id, { text: editing.text.trim() })).then((ok) => ok && setEditing(null));
                  }}
                >
                  <input
                    className="input"
                    value={editing.text}
                    maxLength={MAX_PROMPT_LENGTH}
                    autoFocus
                    aria-label="Edit prompt"
                    onChange={(event) => setEditing({ id: p.id, text: event.target.value })}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!editing.text.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="prompt-settings-text">{p.text}</span>
                  <label className="switch small" title="Can appear as the daily question">
                    <input
                      type="checkbox"
                      checked={p.inRotation}
                      onChange={(event) => void run(() => api.prompts.updateCustom(p.id, { inRotation: event.target.checked }))}
                    />
                    <span className="switch-text">Daily question</span>
                  </label>
                  <AskEveryDay prompt={p} />
                  <button type="button" className="icon-btn" aria-label={`Edit "${p.text}"`} onClick={() => setEditing({ id: p.id, text: p.text })}>
                    <Icon name="pencil" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove "${p.text}"`} onClick={() => void archive(p)}>
                    <Icon name="trash" size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) void run(() => api.prompts.createCustom(draft.trim())).then((ok) => ok && setDraft(''));
        }}
      >
        <label className="visually-hidden" htmlFor="new-prompt">
          New prompt
        </label>
        <input
          id="new-prompt"
          className="input"
          value={draft}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder="Write a question you’d like to be asked…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn" disabled={!draft.trim()}>
          <Icon name="plus" size={16} /> Add
        </button>
      </form>

      <h3 className="sub-heading">Favorite questions</h3>
      {favorites.length === 0 ? (
        <p className="muted">Tap the heart on any question to keep it here.</p>
      ) : (
        <ul className="prompt-settings">
          {favorites.map((p) => (
            <li key={p.id}>
              <span className="prompt-settings-text">{p.text}</span>
              <AskEveryDay prompt={p} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => api.prompts.setFavorite(p.id, false))}>
                <Icon name="heart" size={14} filled /> Unfavorite
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub-heading">Hidden questions</h3>
      {hidden.length === 0 ? (
        <p className="muted">None. Questions you hide from Today’s page appear here.</p>
      ) : (
        <ul className="prompt-settings">
          {hidden.map((p) => (
            <li key={p.id}>
              <span className="prompt-settings-text">{p.text}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => api.prompts.setHidden(p.id, false))}>
                <Icon name="eye" size={14} /> Show again
              </button>
            </li>
          ))}
        </ul>
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
