/** Letters to the future: which are waiting (by date only — they stay sealed) and a way to delete one. */
import type { CapsuleInfo } from '@core/api';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toasts';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { href } from '../../lib/router';
import { SettingsSection } from '../SettingsView';

export function LetterSettings() {
  const { format } = useApp();
  const letters = useQuery('letters', () => api.capsules.list(), ['capsules']);
  const all = letters.data ?? [];
  const waiting = all.filter((l) => l.sealed || l.editable);
  const opened = all.filter((l) => !l.sealed && !l.editable && l.body?.trim());

  const remove = async (letter: CapsuleInfo) => {
    const ok = await confirm({
      title: 'Delete this letter?',
      body: `The letter to ${format.long(letter.openOn)} will be deleted without being opened. This can’t be undone.`,
      confirmLabel: 'Delete letter',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.capsules.remove(letter.id);
      invalidate('capsules');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <SettingsSection
      id="letters"
      title="Letters to the future"
      description="A letter to a future day stays sealed until it comes — even here, only its dates show. On its day it waits at the top of the page."
    >
      {waiting.length === 0 ? (
        <p className="muted">
          No letters waiting. Write one with “Write to a future day…” on Today’s page, or open any future day in the calendar.
        </p>
      ) : (
        <ul className="letter-settings">
          {waiting.map((letter) => (
            <li key={letter.id}>
              <Icon name="envelope" size={18} />
              <span className="letter-settings-text">
                <strong>Opens {format.long(letter.openOn)}</strong>
                <span className="muted">Written {format.medium(letter.writtenOn)}{letter.editable ? ' · can still be changed today' : ''}</span>
              </span>
              {letter.editable && (
                <a className="btn btn-sm" href={href.day(letter.openOn)}>
                  <Icon name="pencil" size={14} /> Change
                </a>
              )}
              <button type="button" className="icon-btn" aria-label={`Delete the letter to ${format.long(letter.openOn)}`} onClick={() => void remove(letter)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened.length > 0 && (
        <p className="muted">
          {opened.length === 1 ? 'One letter has' : `${opened.length} letters have`} opened. They are on their days, and searching
          your journal finds them too.
        </p>
      )}
    </SettingsSection>
  );
}
