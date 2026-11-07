/**
 * The monthly recap, written like a letter to yourself. Recorded statistics
 * and the user's own reflection are kept visibly separate; mJournal never
 * writes or guesses anything about how the month felt.
 */
import { useEffect, useMemo, useState } from 'react';
import type { MonthRecap } from '@core/api';
import { addMonths, formatMonthName, monthOf, type MonthKey } from '@core/dates';
import { energyLabel } from '@core/moods';
import { MAX_INTENTION_LENGTH, MONTHLY_INTENTION_KEY, MONTHLY_LETTER_KEY, MONTHLY_QUESTIONS } from '@core/prompts';
import { parseSearch, type ParsedSearch } from '@core/search';
import { AutoTextarea } from '../components/AutoTextarea';
import { MonthRibbon, MoodBars } from '../components/Charts';
import { CountUp } from '../components/CountUp';
import { Flower, LetterArt, Sprig } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { MoodIcon } from '../components/MoodIcon';
import { PhotoImage, photoAlt } from '../components/Photo';
import { SaveIndicator } from '../components/SaveIndicator';
import { SearchBanner } from '../components/SearchBanner';
import { Tip } from '../components/Tip';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate, useQuery } from '../lib/data';
import { slideClass, type NavDirection } from '../lib/motion';
import { href, navigate } from '../lib/router';
import { saveQueue } from '../lib/saveQueue';
import { ensureThumbnails } from '../lib/thumbnails';
import { useToday } from '../lib/time';
import './month.css';

export function MonthView({ month: routeMonth, query = null }: { month: MonthKey | null; query?: string | null }) {
  const today = useToday();
  const { format } = useApp();
  const month = routeMonth ?? monthOf(today);
  const highlight = useMemo(() => (query ? parseSearch(query) : null), [query]);
  const currentMonth = monthOf(today);
  const recap = useQuery(`recap:${month}`, () => api.months.recap(month), ['entries', 'photos']);
  const data = recap.dataKey === `recap:${month}` ? recap.data : undefined;
  const [slide, setSlide] = useState<NavDirection>(null);
  const goTo = (target: MonthKey) => {
    setSlide(target > month ? 'forward' : 'back');
    navigate(href.month(target));
  };

  useEffect(() => {
    return () => void saveQueue.flush();
  }, [month]);

  return (
    <div className="page month-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Monthly reflection</p>
          <h1>{format.monthYear(month)}</h1>
          <p className="subtitle hand letter-subtitle">a letter to myself</p>
        </div>
        <div className="page-actions">
          <SaveIndicator />
          <button type="button" className="icon-btn bordered nudge-left" aria-label="Previous month" onClick={() => goTo(addMonths(month, -1))}>
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="icon-btn bordered nudge-right"
            aria-label="Next month"
            disabled={month >= currentMonth}
            onClick={() => goTo(addMonths(month, 1))}
          >
            <Icon name="chevron-right" />
          </button>
          {month !== currentMonth && (
            <button type="button" className="btn btn-sm" onClick={() => goTo(currentMonth)}>
              This month
            </button>
          )}
          <a className="btn btn-sm btn-ghost" href={href.year(Number(month.slice(0, 4)))}>
            <Icon name="star" size={15} /> Year in review
          </a>
        </div>
      </header>
      {query && <SearchBanner key={query} query={query} scope=".month-page" onDone={() => navigate(href.month(month), { replace: true })} />}

      <Tip id="monthly" icon="letter">
        <strong>Tip:</strong> the top shows what you recorded this month; the bottom is just for your own words. Answer any
        of the questions you like — or none.
      </Tip>

      {recap.error ? (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{errorMessage(recap.error)}</span>
        </p>
      ) : !data ? (
        <div className="day-loading" aria-busy="true" />
      ) : (
        <div key={month} className={slideClass(slide)}>
          <MonthContent recap={data} onChanged={recap.reload} highlight={highlight} />
        </div>
      )}
    </div>
  );
}

function MonthContent({ recap, onChanged, highlight }: { recap: MonthRecap; onChanged: () => void; highlight: ParsedSearch | null }) {
  const { format, mood: moodFor } = useApp();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const top = recap.moodCounts[0];
  const topMoods = recap.moodCounts.filter((c) => top && c.count === top.count);
  const monthName = formatMonthName(recap.month);

  useEffect(() => ensureThumbnails(recap.photos), [recap.photos]);

  return (
    <>
      <Intention recap={recap} highlight={highlight} />
      <section className="card recorded" aria-labelledby="recorded-title">
        <div className="card-title">
          <h2 id="recorded-title">What I recorded</h2>
          <span className="chip soft-lavender">Recorded data</span>
          <span className="spacer" />
        </div>
        <p className="recorded-note muted">These are simply counts of what you saved — not a judgment of how {monthName} went.</p>
        <dl className="stat-strip">
          <div>
            <dt>Days with an entry</dt>
            <dd>
              <span className="stat-number numeric">
                <CountUp value={recap.daysWithEntries} />
              </span>
              <span className="stat-of"> of {recap.daysInMonth}</span>
            </dd>
          </div>
          <div>
            <dt>Most recorded mood</dt>
            <dd className="stat-moods">
              {topMoods.length === 0 ? (
                <span className="muted">No moods recorded</span>
              ) : (
                topMoods.slice(0, 3).map((c) => {
                  const mood = moodFor(c.mood);
                  return (
                    <span key={c.mood} className="stat-mood">
                      {mood && <MoodIcon icon={mood.icon} color={mood.color} size={24} />}
                      {mood?.label ?? c.mood}
                    </span>
                  );
                })
              )}
            </dd>
          </div>
          <div>
            <dt>Average energy</dt>
            <dd>
              {recap.averageEnergy === null ? (
                <span className="muted">Not recorded</span>
              ) : (
                <>
                  <span className="stat-number numeric">
                    <CountUp value={recap.averageEnergy} decimals={1} />
                  </span>
                  <span className="stat-of"> / 5 · {energyLabel(Math.round(recap.averageEnergy))?.toLowerCase()}</span>
                  <span className="stat-sub">from {recap.energyDays} {recap.energyDays === 1 ? 'day' : 'days'}</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Words &amp; photos</dt>
            <dd>
              <span className="stat-number numeric">
                <CountUp value={recap.totalWords} />
              </span>
              <span className="stat-of"> words</span>
              <span className="stat-sub">
                {recap.photoCount} {recap.photoCount === 1 ? 'photo' : 'photos'}
              </span>
            </dd>
          </div>
        </dl>

        <h3 className="sub-title">Day by day</h3>
        <MonthRibbon month={recap.month} days={recap.days} moodFor={(k) => moodFor(k)} formatDay={format.long} />

        {recap.moodCounts.length > 0 && (
          <>
            <h3 className="sub-title">Moods this month</h3>
            <MoodBars counts={recap.moodCounts} moodFor={(k) => moodFor(k)} />
          </>
        )}
      </section>

      {recap.photos.length > 0 && (
        <section className="month-section" aria-labelledby="month-photos">
          <div className="section-title">
            <h2 id="month-photos">Photos from {monthName}</h2>
            <span className="count">{recap.photos.length}</span>
            <span className="spacer" />
          </div>
          <ul className="collage stagger">
            {recap.photos.slice(0, 9).map((photo, i) => (
              <li key={photo.id}>
                <button type="button" className="photo-tile" onClick={() => setLightbox(i)} aria-label={`Open ${photoAlt(photo, format.long(photo.date))}`}>
                  <PhotoImage photo={photo} alt="" />
                </button>
              </li>
            ))}
          </ul>
          {recap.photos.length > 9 && (
            <a className="btn btn-sm see-all" href={href.memories({ year: recap.month.slice(0, 4), month: recap.month.slice(5) })}>
              See all {recap.photos.length} in Memories
            </a>
          )}
        </section>
      )}

      {recap.moments.length > 0 && (
        <section className="month-section" aria-labelledby="month-moments">
          <div className="section-title">
            <h2 id="month-moments">Moments to revisit</h2>
          </div>
          <ul className="moments stagger">
            {recap.moments.map((moment, i) => {
              const mood = moodFor(moment.mood);
              return (
                <li key={`${moment.date}-${moment.kind}-${i}`}>
                  <a className="moment card" href={href.day(moment.date)}>
                    <span className="moment-reason">
                      <Icon name={moment.kind === 'photos' ? 'memories' : moment.kind === 'longest-entry' ? 'feather' : 'heart'} size={13} filled={moment.kind === 'favorite-day' || moment.kind === 'favorite-answer'} />
                      {moment.reason}
                    </span>
                    <span className="moment-date">
                      {mood && <MoodIcon icon={mood.icon} color={mood.color} size={18} title={mood.label} />}
                      {format.long(moment.date)}
                    </span>
                    {moment.title && <span className="moment-title">{moment.title}</span>}
                    <span className="moment-excerpt">{moment.excerpt || 'Open to revisit this day.'}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="moments-rules muted">
            <Icon name="info" size={14} /> Moments are picked by simple rules only: days you marked as a favorite, answers you
            saved as favorite moments, your longest entry, and days with three or more photos.
          </p>
        </section>
      )}

      <Reflection recap={recap} highlight={highlight} />

      {lightbox !== null && recap.photos[lightbox] && (
        <Lightbox
          photos={recap.photos}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          onChanged={onChanged}
          showOpenDay
        />
      )}
    </>
  );
}

/** One intention for the month: set at its start, shown on Today, looked back on here. */
function Intention({ recap, highlight }: { recap: MonthRecap; highlight: ParsedSearch | null }) {
  const month = recap.month;
  const [text, setText] = useState(recap.reflection[MONTHLY_INTENTION_KEY] ?? '');
  const update = (value: string) => {
    setText(value);
    saveQueue.schedule(`reflection:${month}:${MONTHLY_INTENTION_KEY}`, async () => {
      await api.months.saveReflection(month, MONTHLY_INTENTION_KEY, value);
      invalidate('reflections');
    });
  };
  return (
    <section className="card intention-card" aria-labelledby="intention-title">
      <div className="card-title">
        <Icon name="leaf" size={18} />
        <h2 id="intention-title">My intention for {formatMonthName(month)}</h2>
      </div>
      <p className="muted intention-hint">
        One word or one line to carry through the month — it shows on Today as a gentle reminder.
      </p>
      <AutoTextarea
        aria-labelledby="intention-title"
        className="intention-input"
        value={text}
        highlight={highlight}
        minRows={1}
        maxLength={MAX_INTENTION_LENGTH}
        placeholder="For example: slow mornings, more walks, kinder to myself…"
        onChange={(event) => update(event.target.value)}
      />
    </section>
  );
}

function Reflection({ recap, highlight }: { recap: MonthRecap; highlight: ParsedSearch | null }) {
  const { format } = useApp();
  const [answers, setAnswers] = useState<Record<string, string>>(recap.reflection);
  const month = recap.month;
  const filled = useMemo(() => MONTHLY_QUESTIONS.filter((q) => answers[q.key]?.trim()).length, [answers]);

  const update = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    saveQueue.schedule(`reflection:${month}:${key}`, async () => {
      await api.months.saveReflection(month, key, value);
      invalidate('reflections');
    });
  };

  return (
    <section className="card reflection" aria-labelledby="reflection-title">
      <div className="reflection-head">
        <LetterArt size={58} />
        <div>
          <h2 id="reflection-title">My reflection</h2>
          <p className="muted">
            Your own words about {formatMonthName(month)}. Answer any questions you like — or none.
            {recap.reflectionUpdatedAt && ` Last written ${format.medium(recap.reflectionUpdatedAt.slice(0, 10))}.`}
          </p>
        </div>
        <span className="chip soft-rose reflection-count">
          {filled} of {MONTHLY_QUESTIONS.length} answered
        </span>
      </div>

      <div className="reflection-grid stagger">
        {MONTHLY_QUESTIONS.map((q) => (
          <label key={q.key} className="reflection-q">
            <span className="reflection-question">{q.text}</span>
            <AutoTextarea
              value={answers[q.key] ?? ''}
              highlight={highlight}
              minRows={2}
              placeholder="…"
              onChange={(event) => update(q.key, event.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="letter">
        <div className="letter-head">
          <Sprig size={30} />
          <span className="hand letter-greeting">Dear me,</span>
          <Flower size={22} />
        </div>
        <AutoTextarea
          aria-label={`Letter to myself for ${format.monthYear(month)}`}
          className="lined letter-text"
          value={answers[MONTHLY_LETTER_KEY] ?? ''}
          highlight={highlight}
          minRows={5}
          placeholder="Write a few lines to yourself about this month…"
          onChange={(event) => update(MONTHLY_LETTER_KEY, event.target.value)}
        />
      </div>
    </section>
  );
}
