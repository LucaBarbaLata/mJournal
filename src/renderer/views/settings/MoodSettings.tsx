/** Customizing the mood vocabulary. Moods are hidden rather than deleted so old days keep their meaning. */
import { useState } from 'react';
import type { MoodRecord } from '@core/api';
import { MAX_MOOD_LABEL_LENGTH, MOOD_COLORS, MOOD_ICONS, type MoodColor, type MoodIcon as MoodIconName } from '@core/moods';
import { confirm, Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { MoodIcon } from '../../components/MoodIcon';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate } from '../../lib/data';
import { SettingsSection } from '../SettingsView';

interface Draft {
  key: string | null;
  label: string;
  icon: MoodIconName;
  color: MoodColor;
}

export function MoodSettings() {
  const { moods } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      invalidate('moods', 'entries');
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const move = (index: number, delta: number) => {
    const keys = moods.map((m) => m.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    void run(() => api.moods.reorder(keys));
  };

  const save = async () => {
    if (!draft) return;
    const label = draft.label.trim();
    const ok = await run(() =>
      draft.key
        ? api.moods.update(draft.key, { label, icon: draft.icon, color: draft.color })
        : api.moods.create({ label, icon: draft.icon, color: draft.color }),
    );
    if (ok) setDraft(null);
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Restore the original moods?',
      body: 'The ten original moods get their names, faces and order back, and are shown again. Moods you added are kept.',
      confirmLabel: 'Restore moods',
    });
    if (ok) void run(() => api.moods.resetDefaults());
  };

  return (
    <SettingsSection
      id="moods"
      title="Moods"
      description="Rename, reorder or hide moods, or add your own. Hidden moods stay readable on earlier days."
    >
      <ul className="mood-settings">
        {moods.map((mood: MoodRecord, i) => (
          <li key={mood.key} className={mood.hidden ? 'is-hidden' : undefined}>
            <MoodIcon icon={mood.icon} color={mood.color} size={30} />
            <span className="mood-settings-label">
              {mood.label}
              {mood.hidden && <span className="chip">Hidden</span>}
            </span>
            <span className="mood-settings-actions">
              <button type="button" className="icon-btn" aria-label={`Move ${mood.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="arrow-up" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${mood.label} down`}
                disabled={i === moods.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="arrow-down" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={mood.hidden ? `Show ${mood.label}` : `Hide ${mood.label}`}
                title={mood.hidden ? 'Show in the mood picker' : 'Hide from the mood picker'}
                onClick={() => void run(() => api.moods.update(mood.key, { hidden: !mood.hidden }))}
              >
                <Icon name={mood.hidden ? 'eye' : 'eye-off'} size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Edit ${mood.label}`}
                onClick={() => setDraft({ key: mood.key, label: mood.label, icon: mood.icon, color: mood.color })}
              >
                <Icon name="pencil" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <button type="button" className="btn" onClick={() => setDraft({ key: null, label: '', icon: 'heart', color: 'peach' })}>
          <Icon name="plus" size={16} /> Add a mood
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void reset()}>
          <Icon name="restore" size={16} /> Restore original moods
        </button>
      </div>
      {error && !draft && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => {
          setDraft(null);
          setError(null);
        }}
        title={draft?.key ? 'Edit mood' : 'Add a mood'}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!draft?.label.trim()} onClick={() => void save()}>
              {draft?.key ? 'Save mood' : 'Add mood'}
            </button>
          </>
        }
      >
        {draft && (
          <>
            <div className="mood-draft-preview">
              <MoodIcon icon={draft.icon} color={draft.color} size={48} />
              <span>{draft.label.trim() || 'New mood'}</span>
            </div>
            <label className="field">
              <span className="field-label">Name</span>
              <input
                className="input"
                value={draft.label}
                maxLength={MAX_MOOD_LABEL_LENGTH}
                autoFocus
                placeholder="e.g. Cozy, Hopeful, Proud"
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </label>
            <fieldset className="picker-field">
              <legend className="field-label">Face or symbol</legend>
              <div className="icon-choices">
                {MOOD_ICONS.map((icon) => (
                  <label key={icon} className="icon-choice" title={icon}>
                    <input type="radio" name="mood-icon" checked={draft.icon === icon} onChange={() => setDraft({ ...draft, icon })} />
                    <MoodIcon icon={icon} color={draft.color} size={30} title={icon} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="picker-field">
              <legend className="field-label">Color</legend>
              <div className="color-choices">
                {MOOD_COLORS.map((color) => (
                  <label key={color} className="color-choice" title={color}>
                    <input type="radio" name="mood-color" checked={draft.color === color} onChange={() => setDraft({ ...draft, color })} />
                    <span className="swatch" style={{ background: `var(--mood-${color})` }} aria-hidden="true" />
                    <span className="visually-hidden">{color}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="notice error" role="alert">
                <Icon name="info" size={16} />
                <span>{error}</span>
              </p>
            )}
          </>
        )}
      </Dialog>
    </SettingsSection>
  );
}
