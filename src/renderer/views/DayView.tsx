/** One day of the journal: today's page, or any earlier day. */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type {
  AnswerRecord,
  DayData,
  DayTag,
  EntryPatch,
  FeaturedPrompt,
  ImportResult,
  PhotoRecord,
  PinnedPrompt,
  PromptInfo,
} from '@core/api';
import { addDays, formatMonthName, monthOf, weekday, weekdayName, type DateKey } from '@core/dates';
import { MAX_IMPORT_BATCH, MAX_PHOTOS_PER_DAY } from '@core/photos';
import { categoryLabel, EVERY_WEEKDAY } from '@core/prompts';
import { findMatches, parseSearch, type ParsedSearch } from '@core/search';
import { countWords } from '@core/text';
import { AutoTextarea } from '../components/AutoTextarea';
import { BackupNudge } from '../components/BackupNudge';
import { JournalArt, Sparkle, Sprig } from '../components/Decorations';
import { confirm } from '../components/Dialog';
import { DoodleDialog } from '../components/DoodleDialog';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { MoodIcon } from '../components/MoodIcon';
import { EnergyPicker, MoodPicker } from '../components/MoodPicker';
import { PhotoImage, photoAlt } from '../components/Photo';
import { SaveIndicator } from '../components/SaveIndicator';
import { SearchBanner } from '../components/SearchBanner';
import { YearReviewCard } from '../components/YearReviewCard';
import { Tip } from '../components/Tip';
import { toast } from '../components/Toasts';
import { api, errorMessage, native } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate, useQuery } from '../lib/data';
import { refreshDay, useDayVersion } from '../lib/dayRefresh';
import { greeting, welcomeLine } from '../lib/greeting';
import { burst, clearNavDirection, peekNavDirection, setNavDirection, slideClass } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { saveQueue } from '../lib/saveQueue';
import { ensureThumbnails } from '../lib/thumbnails';
import { useNow, useToday } from '../lib/time';
import { FutureLetterDialog, FutureLetters, OpenedLetters } from './day/Letters';
import { TagPicker } from './day/TagPicker';
import { PromptPicker } from './PromptPicker';
import './day.css';

interface AnswerState {
  promptText: string;
  text: string;
  favorite: boolean;
}

const burstHearts = (anchor: Element | null) =>
  burst(anchor, { shape: 'heart', colors: ['var(--rose-400)', 'var(--rose-300)', 'var(--peach-300)'], count: 8, distance: 30 });

/** Drag type for moving a photo within the day (files dropped from outside carry "Files" instead). */
const PHOTO_DRAG_TYPE = 'application/x-mjournal-photo';

export function DayView({ date, query = null }: { date: DateKey; query?: string | null }) {
  const today = useToday();
  // Opened from a search: its matches are marked on the page.
  const highlight = useMemo(() => (query ? parseSearch(query) : null), [query]);
  const isFuture = date > today;
  // Bumped when the day changes elsewhere (undoing a delete, a quick note): the editor reloads.
  const version = useDayVersion(date);
  const dayKey = `day:${date}:${version}`;
  const day = useQuery(dayKey, () => api.entries.getDay(date));
  const featured = useQuery(`featured:${date}`, () => (isFuture ? Promise.resolve(null) : api.prompts.featured(date)));
  const pinned = useQuery('pinned-prompts', () => api.prompts.pinned(), ['prompts']);
  const ready =
    day.dataKey === dayKey && featured.dataKey === `featured:${date}` && (pinned.data !== undefined || pinned.error !== null);

  useEffect(() => {
    return () => void saveQueue.flush();
  }, [date]);

  return (
    <div className="page day-page">
      <DayHeader date={date} today={today} />
      {query && <SearchBanner key={query} query={query} scope=".day-page" onDone={() => navigate(href.day(date), { replace: true })} />}
      {day.error ? (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>
            {errorMessage(day.error)}{' '}
            <button type="button" className="link-btn" onClick={day.reload}>
              Try again
            </button>
          </span>
        </p>
      ) : !ready ? (
        <div className="day-loading" aria-busy="true" />
      ) : isFuture ? (
        <FutureDay date={date} />
      ) : (
        <DayEditor
          key={`${date}:${version}`}
          date={date}
          today={today}
          initial={day.data!}
          initialFeatured={featured.data ?? null}
          initialPinned={pinned.data ?? []}
          highlight={highlight}
        />
      )}
    </div>
  );
}

function DayHeader({ date, today }: { date: DateKey; today: DateKey }) {
  const { format, settings } = useApp();
  const now = useNow();
  const isToday = date === today;
  const eyebrow = isToday ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : weekdayName(date);
  const streak = useQuery(`streak:${today}`, () => api.stats.streak(today), ['entries']);
  const current = streak.data?.current ?? 0;
  const month = monthOf(today);
  const intention = useQuery(`intention:${month}`, () => api.months.intention(month), ['reflections']);
  const firstWeek = Number(today.slice(8)) <= 7;

  return (
    <header className="page-header day-header">
      <div className="page-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1 key={date}>{format.long(date)}</h1>
        {isToday ? (
          <p className="subtitle">
            {greeting(now, settings.displayName)} <Sparkle size={13} className="greeting-sparkle" />{' '}
            <span className="muted">{welcomeLine(date)}</span>
          </p>
        ) : (
          <p className="subtitle muted">A page from your journal.</p>
        )}
        {isToday && intention.data ? (
          <p className="intention-line">
            <Icon name="leaf" size={14} /> This month:{' '}
            <a href={href.month(month)} className="intention-text">
              {intention.data}
            </a>
          </p>
        ) : isToday && intention.data === '' && firstWeek ? (
          <p className="intention-line muted">
            <Icon name="leaf" size={14} />{' '}
            <a href={href.month(month)}>Set an intention for {formatMonthName(month)}?</a>
          </p>
        ) : null}
      </div>
      <div className="page-actions">
        {isToday && settings.showStreaks && current >= 2 && (
          <span key={current} className="chip soft-sage streak-chip" title="Days in a row with something saved">
            <Icon name="sprout" size={14} /> {current} days in a row
          </span>
        )}
        <SaveIndicator />
        <div className="day-nav" role="group" aria-label="Change day">
          <a
            className="icon-btn bordered nudge-left"
            href={href.day(addDays(date, -1))}
            aria-label="Previous day"
            title="Previous day (Alt+←)"
            onClick={() => setNavDirection('back')}
          >
            <Icon name="chevron-left" />
          </a>
          {date < today ? (
            <a
              className="icon-btn bordered nudge-right"
              href={href.day(addDays(date, 1))}
              aria-label="Next day"
              title="Next day (Alt+→)"
              onClick={() => setNavDirection('forward')}
            >
              <Icon name="chevron-right" />
            </a>
          ) : (
            <span className="icon-btn bordered" aria-hidden="true" style={{ opacity: 0.35 }}>
              <Icon name="chevron-right" />
            </span>
          )}
          {!isToday && (
            <a className="btn btn-sm" href={href.today()}>
              Today
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

function FutureDay({ date }: { date: DateKey }) {
  const { format } = useApp();
  return (
    <div className="card empty">
      <div className="art">
        <JournalArt />
      </div>
      <h2>This page is still blank</h2>
      <p>{format.long(date)} hasn’t happened yet. It will be waiting for you — and you can leave a letter for it.</p>
      <FutureLetters date={date} />
      <a className="btn btn-ghost" href={href.today()}>
        Go to today
      </a>
    </div>
  );
}

function toAnswerMap(answers: AnswerRecord[]): Map<string, AnswerState> {
  return new Map(answers.map((a) => [a.promptId, { promptText: a.promptText, text: a.answer, favorite: a.favorite }]));
}

function DayEditor({
  date,
  today,
  initial,
  initialFeatured,
  initialPinned,
  highlight,
}: {
  date: DateKey;
  today: DateKey;
  initial: DayData;
  initialFeatured: FeaturedPrompt | null;
  initialPinned: PinnedPrompt[];
  highlight: ParsedSearch | null;
}) {
  const { moods, visibleMoods, mood: moodFor, format } = useApp();
  // Prompts asked every day appear on today's page (on their weekdays), first, even before they're answered.
  const [pins, setPins] = useState(initialPinned);
  const pinnedToday = (list: PinnedPrompt[]) =>
    date === today ? list.filter((p) => (p.weekdays >> weekday(date)) & 1 && p.promptId !== initialFeatured?.promptId) : [];
  const [body, setBody] = useState(initial.entry?.body ?? '');
  const [moodNote, setMoodNote] = useState(initial.entry?.moodNote ?? '');
  const [mood, setMood] = useState<string | null>(initial.entry?.mood ?? null);
  const [energy, setEnergy] = useState<number | null>(initial.entry?.energy ?? null);
  const [favorite, setFavorite] = useState(initial.entry?.favorite ?? false);
  const [answers, setAnswers] = useState(() => {
    const map = toAnswerMap(initial.answers);
    for (const pin of pinnedToday(initialPinned)) {
      if (!map.has(pin.promptId)) map.set(pin.promptId, { promptText: pin.text, text: '', favorite: false });
    }
    return map;
  });
  const [featured, setFeatured] = useState(initialFeatured);
  const [extraIds, setExtraIds] = useState<string[]>(() => {
    const pinnedIds = pinnedToday(initialPinned).map((p) => p.promptId);
    const answered = initial.answers
      .filter((a) => a.promptId !== initialFeatured?.promptId && !pinnedIds.includes(a.promptId))
      .map((a) => a.promptId);
    return [...pinnedIds, ...answered];
  });
  const pinnedIds = new Set(pins.map((p) => p.promptId));
  /** The prompts asked on this very day (today's page, today's weekday). */
  const pinnedTodayIds = new Set(pinnedToday(pins).map((p) => p.promptId));
  const [dayTags, setDayTags] = useState<DayTag[]>(initial.tags);
  const [futureLetter, setFutureLetter] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rejected, setRejected] = useState<ImportResult['rejected']>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusPrompt = useRef<string | null>(null);

  // Motion: slide in from the side we came from, or let the cards rise in one by one.
  const [direction] = useState(peekNavDirection);
  const [entering, setEntering] = useState(direction === null);
  useEffect(() => {
    clearNavDirection();
    const timer = window.setTimeout(() => setEntering(false), 1100);
    return () => window.clearTimeout(timer);
  }, []);
  const [freshPhotos, setFreshPhotos] = useState<ReadonlySet<string>>(new Set());
  const writingCard = useRef<HTMLElement>(null);
  const writingTimer = useRef<number | undefined>(undefined);
  const markWriting = () => {
    const card = writingCard.current;
    if (!card) return;
    card.classList.add('is-writing');
    window.clearTimeout(writingTimer.current);
    writingTimer.current = window.setTimeout(() => card.classList.remove('is-writing'), 900);
  };

  const photosQuery = useQuery(`day-photos:${date}`, () => api.entries.getDay(date).then((d) => d.photos), ['photos']);
  const photos: PhotoRecord[] = photosQuery.data ?? initial.photos;
  useEffect(() => ensureThumbnails(photos), [photos]);

  const pickerMoods = useMemo(
    () => (mood && !visibleMoods.some((m) => m.key === mood) ? [...visibleMoods, ...moods.filter((m) => m.key === mood)] : visibleMoods),
    [mood, moods, visibleMoods],
  );

  const saveEntry = useCallback(
    (field: string, patch: EntryPatch, immediate = false) => {
      const run = async () => {
        await api.entries.update(date, patch);
        invalidate('entries');
      };
      if (immediate) void saveQueue.saveNow(`${field}:${date}`, run);
      else saveQueue.schedule(`${field}:${date}`, run);
    },
    [date],
  );

  const updateAnswer = (promptId: string, promptText: string, text: string) => {
    setAnswers((prev) => new Map(prev).set(promptId, { promptText, text, favorite: prev.get(promptId)?.favorite ?? false }));
    saveQueue.schedule(`answer:${date}:${promptId}`, async () => {
      await api.entries.saveAnswer(date, { promptId, promptText, answer: text });
      invalidate('entries');
    });
  };

  const toggleAnswerFavorite = async (promptId: string, button: HTMLElement) => {
    const current = answers.get(promptId);
    if (!current?.text.trim()) return;
    if (!current.favorite) burstHearts(button);
    await saveQueue.flush();
    const next = !current.favorite;
    setAnswers((prev) => new Map(prev).set(promptId, { ...current, favorite: next }));
    try {
      await api.entries.setAnswerFavorite(date, promptId, next);
      invalidate('entries');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removePrompt = async (promptId: string) => {
    if (answers.get(promptId)?.text.trim()) {
      const ok = await confirm({
        title: 'Remove this prompt?',
        body: 'Your answer to it will be removed from this day.',
        confirmLabel: 'Remove',
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (pinnedTodayIds.has(promptId)) {
      // Asked every day: the card stays, just empty again.
      setAnswers((prev) => new Map(prev).set(promptId, { ...prev.get(promptId)!, text: '', favorite: false }));
    } else {
      setExtraIds((ids) => ids.filter((id) => id !== promptId));
      setAnswers((prev) => {
        const next = new Map(prev);
        next.delete(promptId);
        return next;
      });
    }
    try {
      await saveQueue.flush();
      await api.entries.removeAnswer(date, promptId);
      invalidate('entries');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const togglePin = async (promptId: string) => {
    const wasPinned = pinnedIds.has(promptId);
    try {
      const next = await api.prompts.setPinned(promptId, wasPinned ? null : EVERY_WEEKDAY);
      setPins(next);
      invalidate('prompts');
      if (wasPinned && !answers.get(promptId)?.text.trim()) {
        setExtraIds((ids) => ids.filter((id) => id !== promptId));
        setAnswers((prev) => {
          const map = new Map(prev);
          map.delete(promptId);
          return map;
        });
      }
      toast(wasPinned ? 'This question won’t be asked every day any more' : 'You’ll be asked this every day — change it in Settings → Prompts');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const addPrompt = (prompt: PromptInfo) => {
    setPickerOpen(false);
    if (prompt.id === featured?.promptId || extraIds.includes(prompt.id)) return;
    setExtraIds((ids) => [...ids, prompt.id]);
    setAnswers((prev) =>
      prev.has(prompt.id) ? prev : new Map(prev).set(prompt.id, { promptText: prompt.text, text: '', favorite: false }),
    );
    focusPrompt.current = prompt.id;
  };

  useEffect(() => {
    if (!focusPrompt.current) return;
    document.getElementById(`answer-${focusPrompt.current}`)?.focus();
    focusPrompt.current = null;
  }, [extraIds]);

  const changeFeatured = async (action: 'shuffle' | 'hide' | 'skip' | 'unskip' | 'favorite', anchor?: HTMLElement) => {
    if (!featured) return;
    setBusy(true);
    try {
      if (action === 'favorite') {
        if (!featured.favorite) burstHearts(anchor ?? null);
        await api.prompts.setFavorite(featured.promptId, !featured.favorite);
        setFeatured({ ...featured, favorite: !featured.favorite });
        invalidate('prompts');
        return;
      }
      await saveQueue.flush();
      if (action === 'hide') {
        await api.prompts.setHidden(featured.promptId, true);
        invalidate('prompts');
      }
      const next =
        action === 'shuffle' || action === 'hide'
          ? await api.prompts.shuffle(date)
          : await api.prompts.setSkipped(date, action === 'skip');
      if (next && next.promptId !== featured.promptId) {
        const oldId = featured.promptId;
        setExtraIds((ids) => {
          const withoutNew = ids.filter((id) => id !== next.promptId);
          return answers.get(oldId)?.text.trim() && !withoutNew.includes(oldId) ? [...withoutNew, oldId] : withoutNew;
        });
      }
      setFeatured(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = (result: ImportResult) => {
    if (result.imported.length > 0) {
      setFreshPhotos((ids) => new Set([...ids, ...result.imported.map((p) => p.id)]));
      photosQuery.reload();
      ensureThumbnails(result.imported);
      invalidate('entries', 'photos');
    }
    setRejected(result.rejected);
  };

  const pickPhotos = async () => {
    try {
      handleImport(await api.photos.pickAndImport(date));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Reordering: drag a photo onto another one, or use "Move earlier/later" in the photo viewer.
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<{ id: string; before: boolean } | null>(null);
  const saveOrder = async (ids: string[]) => {
    try {
      await api.photos.reorder(date, ids);
      photosQuery.reload();
      invalidate('photos');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const dropPhoto = (targetId: string, before: boolean) => {
    const moving = dragged;
    setDragged(null);
    setDropBefore(null);
    if (!moving || moving === targetId) return;
    const ids = photos.map((p) => p.id).filter((id) => id !== moving);
    const at = ids.indexOf(targetId) + (before ? 0 : 1);
    ids.splice(at, 0, moving);
    void saveOrder(ids);
  };
  const shiftPhoto = async (id: string, delta: -1 | 1) => {
    const ids = photos.map((p) => p.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await saveOrder(ids);
    setLightbox(to);
  };

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // A day holds at most MAX_PHOTOS_PER_DAY photos, so there's no point reading more files than that.
      const images = files.slice(0, MAX_PHOTOS_PER_DAY);
      const result: ImportResult = {
        imported: [],
        rejected: files
          .slice(MAX_PHOTOS_PER_DAY)
          .map((file) => ({ name: file.name || 'image', reason: `A day can hold up to ${MAX_PHOTOS_PER_DAY} photos.` })),
      };
      try {
        // Sent in batches: the main process accepts MAX_IMPORT_BATCH files per call.
        for (let start = 0; start < images.length; start += MAX_IMPORT_BATCH) {
          const withPaths = images
            .slice(start, start + MAX_IMPORT_BATCH)
            .map((file) => ({ file, path: native.pathForFile(file) }));
          const byPath = withPaths.filter((f) => f.path).map((f) => f.path);
          if (byPath.length > 0) {
            const r = await api.photos.importFiles(date, byPath);
            result.imported.push(...r.imported);
            result.rejected.push(...r.rejected);
          }
          const inMemory = withPaths.filter((f) => !f.path);
          if (inMemory.length > 0) {
            const data = await Promise.all(
              inMemory.map(async ({ file }) => ({ name: file.name || 'pasted-image.png', data: new Uint8Array(await file.arrayBuffer()) })),
            );
            const r = await api.photos.importData(date, data);
            result.imported.push(...r.imported);
            result.rejected.push(...r.rejected);
          }
        }
        handleImport(result);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    // handleImport only touches stable setters and the query's stable reload.
    [date],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      void importFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importFiles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
      if (event.key === 'ArrowLeft') {
        setNavDirection('back');
        navigate(href.day(addDays(date, -1)));
      }
      if (event.key === 'ArrowRight' && date < today) {
        setNavDirection('forward');
        navigate(href.day(addDays(date, 1)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, today]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void importFiles([...event.dataTransfer.files]);
  };

  const deleteDay = async () => {
    const ok = await confirm({
      title: 'Delete this day’s entry?',
      body: `Your writing, mood, energy, answers, tags and photos for ${format.long(date)} move to “Recently removed” in Settings, where you can restore them.`,
      confirmLabel: 'Delete entry',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await saveQueue.flush();
      const { removedId } = await api.entries.remove(date);
      invalidate('entries', 'photos');
      refreshDay(date);
      if (removedId !== null) {
        toast('Entry deleted', {
          label: 'Undo',
          onClick: () =>
            void api.entries.restoreRemoved(removedId).then(
              () => {
                invalidate('entries', 'photos', 'tags');
                refreshDay(date);
              },
              (err: unknown) => toast(errorMessage(err)),
            ),
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const featuredAnswer = featured ? (answers.get(featured.promptId)?.text ?? '') : '';
  const words = countWords(body);
  const selectedMood = moodFor(mood);
  const hasContent = Boolean(
    body.trim() ||
      moodNote.trim() ||
      mood ||
      energy ||
      photos.length > 0 ||
      dayTags.length > 0 ||
      [...answers.values()].some((a) => a.text.trim()),
  );
  // #tags follow the writing, so the chips are reloaded after saves.
  const tagsQuery = useQuery(`day-tags:${date}`, () => api.tags.forDay(date), ['entries', 'tags']);
  useEffect(() => {
    if (tagsQuery.data) setDayTags(tagsQuery.data);
  }, [tagsQuery.data]);

  // A small celebration when today's page gets its first saved thing.
  const hadContent = useRef(hasContent);
  useEffect(() => {
    if (hasContent && !hadContent.current && date === today) {
      burst(document.querySelector('[data-testid="save-status"]'), { count: 14, distance: 48 });
    }
    hadContent.current = hasContent;
  }, [hasContent, date, today]);

  return (
    <div
      className={`day-layout${entering ? ' entering' : ''} ${slideClass(direction)}${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="image-plus" size={28} />
          <span>Drop photos to add them to this day</span>
        </div>
      )}

      <div className={`day-main${entering ? ' stagger' : ''}`}>
        <OpenedLetters date={date} highlight={highlight} />
        {date === today && <BackupNudge />}
        {date === today && <YearReviewCard today={today} />}
        {date === today && (
          <Tip id="today" icon="image-plus">
            <strong>Tip:</strong> drag photos straight onto the page, or paste a screenshot, to add them to the day.{' '}
            <strong>Alt + ← / →</strong> moves between days.
          </Tip>
        )}
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
            <button type="button" className="link-btn" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        )}

        {featured && !featured.skipped && (
          <section className="card question-card" aria-labelledby="featured-question">
            <Sparkle size={14} className="question-sparkle" color="var(--lavender-300)" />
            <div className="question-top">
              <p className="eyebrow">
                <Sparkle size={12} /> {date === today ? 'Today’s question' : 'This day’s question'}
                <span className="question-category">· {categoryLabel(featured.category)}</span>
              </p>
              <div className="question-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Don’t suggest this question again"
                  title="Don’t suggest this question again"
                  disabled={busy}
                  onClick={() => void changeFeatured('hide')}
                >
                  <Icon name="eye-off" size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-pressed={featured.favorite}
                  aria-label={featured.favorite ? 'Remove question from favorites' : 'Add question to favorites'}
                  title={featured.favorite ? 'Favorite question' : 'Add to favorites'}
                  onClick={(event) => void changeFeatured('favorite', event.currentTarget)}
                >
                  <Icon
                    key={String(featured.favorite)}
                    name="heart"
                    size={18}
                    filled={featured.favorite}
                    className={featured.favorite ? 'heart-pop' : undefined}
                  />
                </button>
              </div>
            </div>
            <h2 key={featured.promptId} id="featured-question" className="question-text">
              {featured.text}
            </h2>
            <AutoTextarea
              id={`answer-${featured.promptId}`}
              aria-labelledby="featured-question"
              value={featuredAnswer}
              highlight={highlight}
              minRows={2}
              placeholder="A word, a line or a whole page — whatever feels right."
              onChange={(event) => updateAnswer(featured.promptId, featured.text, event.target.value)}
            />
            <div className="question-footer">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void changeFeatured('shuffle')}>
                <Icon
                  key={featured.shuffles}
                  name="shuffle"
                  size={15}
                  className={featured.shuffles > 0 ? 'shuffle-icon' : undefined}
                />{' '}
                Another question
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void changeFeatured('skip')}>
                Skip for today
              </button>
            </div>
          </section>
        )}
        {featured?.skipped && (
          <p className="skipped-note">
            <Sprig size={22} /> No question today — and that’s perfectly fine.{' '}
            <button type="button" className="link-btn" onClick={() => void changeFeatured('unskip')}>
              Bring it back
            </button>
          </p>
        )}

        {extraIds.map((promptId) => {
          const state = answers.get(promptId);
          if (!state) return null;
          const isPinned = pinnedIds.has(promptId);
          // An unanswered card of a question asked every day has nothing to remove: it would come back.
          const removable = !(pinnedTodayIds.has(promptId) && !state.text.trim());
          return (
            <section key={promptId} className={`card answer-card${isPinned ? ' pinned' : ''}`} aria-labelledby={`q-${promptId}`}>
              <div className="answer-top">
                <h3 id={`q-${promptId}`} className="answer-question">
                  {state.promptText}
                </h3>
                <button
                  type="button"
                  className="icon-btn pin-btn"
                  aria-pressed={isPinned}
                  aria-label={isPinned ? 'Stop asking this every day' : 'Ask me this every day'}
                  title={isPinned ? 'Asked every day — click to stop' : 'Ask me this every day'}
                  onClick={() => void togglePin(promptId)}
                >
                  <Icon name="pin" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-pressed={state.favorite}
                  disabled={!state.text.trim()}
                  aria-label={state.favorite ? 'Unmark favorite moment' : 'Keep as a favorite moment'}
                  title={state.text.trim() ? 'Keep as a favorite moment' : 'Write something first'}
                  onClick={(event) => void toggleAnswerFavorite(promptId, event.currentTarget)}
                >
                  <Icon
                    key={String(state.favorite)}
                    name="heart"
                    size={17}
                    filled={state.favorite}
                    className={state.favorite ? 'heart-pop' : undefined}
                  />
                </button>
                {removable && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove this prompt"
                    title="Remove this prompt"
                    onClick={() => void removePrompt(promptId)}
                  >
                    <Icon name="close" size={17} />
                  </button>
                )}
              </div>
              <AutoTextarea
                id={`answer-${promptId}`}
                aria-labelledby={`q-${promptId}`}
                value={state.text}
                highlight={highlight}
                minRows={2}
                placeholder="Take your time…"
                onChange={(event) => updateAnswer(promptId, state.promptText, event.target.value)}
              />
            </section>
          );
        })}

        <button type="button" className="add-prompt" onClick={() => setPickerOpen(true)}>
          <Icon name="plus" size={18} /> Add a prompt
          <span className="muted">· optional</span>
        </button>

        <section className="card writing-card" aria-labelledby="free-writing" ref={writingCard}>
          <div className="card-title">
            <Icon name="feather" size={19} />
            <h2 id="free-writing">Free writing</h2>
            <span className="spacer" />
            <span className="word-count numeric">
              {words} {words === 1 ? 'word' : 'words'}
            </span>
          </div>
          <AutoTextarea
            aria-labelledby="free-writing"
            className="lined"
            value={body}
            highlight={highlight}
            minRows={7}
            placeholder="Anything else on your mind? Write freely…"
            onChange={(event) => {
              setBody(event.target.value);
              saveEntry('body', { body: event.target.value });
              markWriting();
            }}
          />
        </section>

        <div className="day-footer">
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={favorite}
            onClick={(event) => {
              if (!favorite) burstHearts(event.currentTarget.querySelector('svg'));
              setFavorite(!favorite);
              saveEntry('favorite', { favorite: !favorite }, true);
            }}
          >
            <Icon key={String(favorite)} name="heart" size={16} filled={favorite} className={favorite ? 'heart-pop' : undefined} />
            {favorite ? 'A favorite day' : 'Mark as a favorite day'}
          </button>
          {date === today && (
            <button type="button" className="btn btn-ghost" onClick={() => setFutureLetter(true)}>
              <Icon name="envelope" size={16} /> Write to a future day…
            </button>
          )}
          {hasContent && (
            <button type="button" className="btn btn-ghost" onClick={() => void deleteDay()}>
              <Icon name="trash" size={16} /> Delete entry
            </button>
          )}
        </div>
        <FutureLetterDialog open={futureLetter} onClose={() => setFutureLetter(false)} />
      </div>

      <section className="card day-checkin" aria-labelledby="checkin-title">
        <div className="card-title">
          <h2 id="checkin-title">How are you feeling?</h2>
        </div>
        <MoodPicker
          moods={pickerMoods}
          value={mood}
          onChange={(key) => {
            setMood(key);
            saveEntry('mood', { mood: key }, true);
          }}
        />
        {(mood || moodNote) && (
          <label className="field mood-note">
            <span className="field-label">
              {selectedMood ? (
                <>
                  <MoodIcon icon={selectedMood.icon} color={selectedMood.color} size={18} /> What’s behind feeling {selectedMood.label.toLowerCase()}?
                </>
              ) : (
                'About my mood'
              )}{' '}
              <span className="muted">(optional)</span>
            </span>
            <AutoTextarea
              className="mood-note-input"
              value={moodNote}
              highlight={highlight}
              minRows={1}
              maxLength={2000}
              placeholder="A few words, if you like"
              onChange={(event) => {
                setMoodNote(event.target.value);
                saveEntry('moodNote', { moodNote: event.target.value });
              }}
            />
          </label>
        )}
        <div className="energy-block">
          <h3 className="field-label" id="energy-title">
            Energy
          </h3>
          <EnergyPicker
            value={energy}
            onChange={(value) => {
              setEnergy(value);
              saveEntry('energy', { energy: value }, true);
            }}
          />
        </div>
        <TagPicker date={date} tags={dayTags} onChange={setDayTags} />
      </section>

      <section className="card day-photos" aria-labelledby="photos-title">
        <div className="card-title">
          <Icon name="memories" size={19} />
          <h2 id="photos-title">Photos</h2>
          <span className="spacer" />
          {photos.length > 0 && (
            <>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDrawing(true)}>
                <Icon name="brush" size={14} /> Draw
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void pickPhotos()}>
                <Icon name="plus" size={14} /> Add
              </button>
            </>
          )}
        </div>
        {photos.length > 0 ? (
          <ul className="photo-grid stagger" aria-label="Photos from this day">
            {photos.map((photo, i) => (
              <li
                key={photo.id}
                className={
                  [
                    dragged === photo.id && 'is-dragged',
                    dropBefore?.id === photo.id && (dropBefore.before ? 'drop-before' : 'drop-after'),
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onDragOver={(event) => {
                  if (!dragged || !event.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const box = event.currentTarget.getBoundingClientRect();
                  const before = event.clientX < box.left + box.width / 2;
                  if (dropBefore?.id !== photo.id || dropBefore.before !== before) setDropBefore({ id: photo.id, before });
                }}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  dropPhoto(photo.id, dropBefore?.id === photo.id ? dropBefore.before : true);
                }}
              >
                <button
                  type="button"
                  className={`photo-tile${freshPhotos.has(photo.id) ? ' developing' : ''}${
                    highlight && findMatches(photo.caption, highlight).length > 0 ? ' search-hit' : ''
                  }`}
                  onClick={() => setLightbox(i)}
                  aria-label={`Open ${photoAlt(photo, format.long(date))}`}
                  draggable={photos.length > 1}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(PHOTO_DRAG_TYPE, photo.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragged(photo.id);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setDropBefore(null);
                  }}
                >
                  <PhotoImage photo={photo} alt="" />
                  {photo.favorite && (
                    <span className="photo-fav" aria-hidden="true">
                      <Icon name="heart" size={12} filled />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <button type="button" className="photo-drop" onClick={() => void pickPhotos()}>
              <Icon name="image-plus" size={24} />
              <span>
                <strong>Add photos</strong>
                <br />
                <span className="muted">or drop them here · paste works too</span>
              </span>
            </button>
            <button type="button" className="btn btn-sm btn-ghost draw-something" onClick={() => setDrawing(true)}>
              <Icon name="brush" size={14} /> Or draw something
            </button>
          </>
        )}
        <DoodleDialog open={drawing} date={date} onClose={() => setDrawing(false)} onSaved={handleImport} />
        {rejected.length > 0 && (
          <div className="notice" role="status">
            <Icon name="info" size={16} />
            <div>
              {rejected.length === 1 ? 'One file wasn’t added:' : `${rejected.length} files weren’t added:`}
              <ul>
                {rejected.map((r, i) => (
                  <li key={i}>
                    <strong>{r.name}</strong> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <OnThisDay date={date} />

      <PromptPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addPrompt}
        exclude={new Set([...(featured ? [featured.promptId] : []), ...extraIds])}
      />
      {lightbox !== null && photos[lightbox] && (
        <Lightbox
          photos={photos}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          onChanged={() => photosQuery.reload()}
          onShift={(id, delta) => void shiftPhoto(id, delta)}
        />
      )}
    </div>
  );
}

function OnThisDay({ date }: { date: DateKey }) {
  const { format, mood: moodFor } = useApp();
  const earlier = useQuery(`on-this-day:${date}`, () => api.entries.onThisDay(date));
  if (!earlier.data || earlier.data.length === 0) return null;
  return (
    <section className="card on-this-day" aria-labelledby="otd-title">
      <div className="card-title">
        <Icon name="clock" size={18} />
        <h2 id="otd-title">On this day</h2>
      </div>
      <ul>
        {earlier.data.map((day) => {
          const mood = moodFor(day.mood);
          const years = Number(date.slice(0, 4)) - Number(day.date.slice(0, 4));
          return (
            <li key={day.date}>
              <a href={href.day(day.date)} className="otd-item">
                <span className="otd-when">
                  {years === 1 ? 'One year ago' : `${years} years ago`} · {format.medium(day.date)}
                </span>
                <span className="otd-text">
                  {mood && <MoodIcon icon={mood.icon} color={mood.color} size={18} title={mood.label} />}
                  {day.excerpt || (mood ? `Felt ${mood.label.toLowerCase()}` : 'A saved day')}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
