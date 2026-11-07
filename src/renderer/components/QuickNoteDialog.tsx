/**
 * The quick note: a line (and, if you like, a mood) added to today's page without opening it. The note goes to
 * the end of today's free writing with the time in front, e.g. "14:05 — coffee with Ana".
 */
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate } from '../lib/data';
import { refreshDay } from '../lib/dayRefresh';
import { takeQuickNoteRequest, useQuickNoteRequested } from '../lib/quickNote';
import { href, navigate } from '../lib/router';
import { saveQueue } from '../lib/saveQueue';
import { useToday } from '../lib/time';
import { AutoTextarea } from './AutoTextarea';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { MoodPicker } from './MoodPicker';
import { toast } from './Toasts';

export function QuickNoteDialog() {
  const requested = useQuickNoteRequested();
  const today = useToday();
  const { visibleMoods, format } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (requested && takeQuickNoteRequest()) setOpen(true);
  }, [requested]);

  const close = () => {
    setOpen(false);
    setText('');
    setMood(null);
    setError(null);
  };

  const save = async () => {
    const note = text.trim();
    if ((!note && !mood) || busy) return;
    setBusy(true);
    setError(null);
    try {
      // What is being typed on the day page is saved first, so nothing is overwritten.
      await saveQueue.flush();
      if (note) await api.entries.appendToBody(today, `${format.time(new Date().toISOString())} — ${note}`);
      if (mood) await api.entries.update(today, { mood });
      invalidate('entries');
      refreshDay(today);
      toast('Added to today’s page', { label: 'Open', onClick: () => navigate(href.today()) });
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!busy}
      title={`Quick note · ${format.medium(today)}`}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="quick-note" className="btn btn-primary" disabled={busy || (!text.trim() && !mood)}>
            {busy && <span className="spinner" aria-hidden="true" />} Add to today
          </button>
        </>
      }
    >
      <form
        id="quick-note"
        className="quick-note"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <AutoTextarea
          aria-label="Quick note"
          className="quick-note-text"
          value={text}
          minRows={3}
          autoFocus
          placeholder="What’s happening? A line is enough."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <p className="muted quick-note-hint">
          It goes to the end of today’s writing, with the time. <span className="kbd">Ctrl + Enter</span> adds it.
        </p>
        <details className="quick-note-mood">
          <summary>
            <Icon name="heart" size={14} /> How are you feeling? <span className="muted">(optional — sets today’s mood)</span>
          </summary>
          <MoodPicker moods={visibleMoods} value={mood} onChange={setMood} />
        </details>
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}
      </form>
    </Dialog>
  );
}
