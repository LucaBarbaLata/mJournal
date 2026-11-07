/**
 * Letters to a future day. On a future day's page you can write one; it can be changed until the end of the
 * day it was written, then it stays sealed — mJournal doesn't even show its text — until its day comes. On that
 * day it waits at the top of the page.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { CapsuleInfo } from '@core/api';
import { addDays, type DateKey } from '@core/dates';
import { findMatches, type ParsedSearch } from '@core/search';
import { AutoTextarea } from '../../components/AutoTextarea';
import { confirm, Dialog } from '../../components/Dialog';
import { Flower, Sprig } from '../../components/Decorations';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { href, navigate } from '../../lib/router';
import { saveQueue } from '../../lib/saveQueue';
import { useToday } from '../../lib/time';

function Marked({ text, highlight }: { text: string; highlight: ParsedSearch | null }) {
  if (!highlight) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  findMatches(text, highlight).forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>);
    at = end;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function Paragraphs({ text, highlight = null }: { text: string; highlight?: ParsedSearch | null }) {
  return (
    <div className="letter-body">
      {text
        .split(/\n{2,}/u)
        .filter((part) => part.trim())
        .map((part, i) => (
          <p key={i}>
            <Marked text={part} highlight={highlight} />
          </p>
        ))}
    </div>
  );
}

/** Letters whose day has come, at the top of that day's page. */
export function OpenedLetters({ date, highlight = null }: { date: DateKey; highlight?: ParsedSearch | null }) {
  const { format } = useApp();
  const letters = useQuery(`letters:${date}`, () => api.capsules.forDay(date), ['capsules']);
  const opened = (letters.data ?? []).filter((l): l is CapsuleInfo & { body: string } => !l.sealed && !l.editable && Boolean(l.body?.trim()));
  const unread = opened.filter((l) => !l.openedAt).map((l) => l.id).join(',');

  useEffect(() => {
    if (!unread) return;
    for (const id of unread.split(',')) void api.capsules.markOpened(Number(id)).catch(() => undefined);
  }, [unread]);

  if (opened.length === 0) return null;
  return (
    <>
      {opened.map((letter) => (
        <section key={letter.id} className="card letter-card" aria-labelledby={`letter-${letter.id}`}>
          <div className="letter-card-head">
            <Icon name="envelope" size={19} />
            <h2 id={`letter-${letter.id}`}>A letter from {format.long(letter.writtenOn)}</h2>
          </div>
          <div className="letter-head">
            <Sprig size={26} />
            <span className="hand letter-greeting">Dear me,</span>
            <Flower size={20} />
          </div>
          <Paragraphs text={letter.body} highlight={highlight} />
        </section>
      ))}
    </>
  );
}

function LetterEditor({ letter, date }: { letter: CapsuleInfo; date: DateKey }) {
  const { format } = useApp();
  const [body, setBody] = useState(letter.body ?? '');
  const update = (value: string) => {
    setBody(value);
    saveQueue.schedule(`letter:${letter.id}`, async () => {
      await api.capsules.save(letter.id, value);
    });
  };
  return (
    <section className="card letter-card editing" aria-labelledby={`letter-${letter.id}`}>
      <div className="letter-card-head">
        <Icon name="envelope" size={19} />
        <h2 id={`letter-${letter.id}`}>A letter to {format.long(date)}</h2>
      </div>
      <p className="muted letter-note">
        It stays sealed until then — even from you. You can still change it until the end of today.
      </p>
      <div className="letter-head">
        <Sprig size={26} />
        <span className="hand letter-greeting">Dear me,</span>
        <Flower size={20} />
      </div>
      <AutoTextarea
        aria-label={`Letter to ${format.long(date)}`}
        className="lined letter-text"
        value={body}
        minRows={6}
        autoFocus={!letter.body}
        placeholder="What would you like to tell yourself on this day?"
        onChange={(event) => update(event.target.value)}
      />
    </section>
  );
}

/** On a future day's page: sealed letters waiting for it, today's letter to it, or a way to start one. */
export function FutureLetters({ date }: { date: DateKey }) {
  const { format } = useApp();
  const letters = useQuery(`letters:${date}`, () => api.capsules.forDay(date), ['capsules']);
  const [error, setError] = useState<string | null>(null);
  const list = letters.data ?? [];
  const editable = list.filter((l) => l.editable);
  const sealed = list.filter((l) => l.sealed);

  const start = async () => {
    setError(null);
    try {
      await api.capsules.create(date);
      invalidate('capsules');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (letter: CapsuleInfo) => {
    const ok = await confirm({
      title: 'Delete this sealed letter?',
      body: `The letter you wrote on ${format.long(letter.writtenOn)} will be deleted without being opened. This can’t be undone.`,
      confirmLabel: 'Delete letter',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.capsules.remove(letter.id);
      invalidate('capsules');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!letters.data) return null;
  return (
    <div className="future-letters">
      {sealed.map((letter) => (
        <p key={letter.id} className="sealed-letter">
          <Icon name="envelope" size={18} />
          <span>
            A sealed letter, written on {format.long(letter.writtenOn)}, is waiting for this day.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(letter)}>
            Delete…
          </button>
        </p>
      ))}
      {editable.map((letter) => (
        <LetterEditor key={letter.id} letter={letter} date={date} />
      ))}
      {editable.length === 0 && (
        <button type="button" className="btn btn-primary" onClick={() => void start()}>
          <Icon name="envelope" size={16} /> Write a letter to this day
        </button>
      )}
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** "Write to a future day…": pick the day, then write on its page. */
export function FutureLetterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = useToday();
  const tomorrow = addDays(today, 1);
  const [day, setDay] = useState(addDays(today, 365));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="A letter to a future day"
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="future-letter"
            className="btn btn-primary"
            disabled={!day || day < tomorrow}
          >
            Write the letter
          </button>
        </>
      }
    >
      <form
        id="future-letter"
        onSubmit={(event) => {
          event.preventDefault();
          if (!day || day < tomorrow) return;
          onClose();
          navigate(href.day(day));
        }}
      >
        <p className="muted">
          Write to yourself on a day that hasn’t come yet — a birthday, the first day of next year, a year from now. The
          letter stays sealed until that day, and then it’s waiting at the top of its page.
        </p>
        <label className="field">
          <span className="field-label">The day it opens</span>
          <input type="date" className="input" min={tomorrow} value={day} required onChange={(event) => setDay(event.target.value)} />
        </label>
      </form>
    </Dialog>
  );
}
