/**
 * The year in review, written like the monthly letter: what was recorded (counts only, never interpreted),
 * the year in moods, month by month with each month's intention, moments picked by the same published rules,
 * a few photos, the year's tags and the person's own reflection.
 */
import { useEffect, useMemo, useState } from 'react';
import type { YearRecap } from '@core/api';
import { formatMonthName, type MonthKey } from '@core/dates';
import { energyLabel } from '@core/moods';
import { YEARLY_LETTER_KEY, YEARLY_QUESTIONS } from '@core/prompts';
import { parseSearch, type ParsedSearch } from '@core/search';
import { tagKey } from '@core/tags';
import { AutoTextarea } from '../components/AutoTextarea';
import { MoodBars, YearInMoodsGrid } from '../components/Charts';
import { CountUp } from '../components/CountUp';
import { Flower, LetterArt, Sparkles, Sprig } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { MoodIcon } from '../components/MoodIcon';
import { PhotoImage, photoAlt } from '../components/Photo';
import { SaveIndicator } from '../components/SaveIndicator';
import { SearchBanner } from '../components/SearchBanner';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate, useQuery } from '../lib/data';
import { href, navigate } from '../lib/router';
import { saveQueue } from '../lib/saveQueue';
import { ensureThumbnails } from '../lib/thumbnails';
import { useToday } from '../lib/time';
import './month.css';
import './year.css';

const monthLabel = (month: MonthKey, width: 'short' | 'long') =>
  width === 'long' ? `${formatMonthName(month)} ${month.slice(0, 4)}` : formatMonthName(month, 'short');

export function YearView({ year: routeYear, query = null }: { year: number | null; query?: string | null }) {
  const today = useToday();
  const thisYear = Number(today.slice(0, 4));
  const year = routeYear ?? thisYear;
  const key = `year-recap:${year}`;
  const recap = useQuery(key, () => api.years.recap(year), ['entries', 'photos', 'reflections', 'tags']);
  const data = recap.dataKey === key ? recap.data : undefined;
  const highlight = useMemo(() => (query ? parseSearch(query) : null), [query]);

  useEffect(() => {
    return () => void saveQueue.flush();
  }, [year]);

  return (
    <div className="page month-page year-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Year in review</p>
          <h1 className="numeric">{year}</h1>
          <p className="subtitle hand letter-subtitle">a letter to myself</p>
        </div>
        <div className="page-actions">
          <SaveIndicator />
          <button type="button" className="icon-btn bordered nudge-left" aria-label="Previous year" onClick={() => navigate(href.year(year - 1))}>
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="icon-btn bordered nudge-right"
            aria-label="Next year"
            disabled={year >= thisYear}
            onClick={() => navigate(href.year(year + 1))}
          >
            <Icon name="chevron-right" />
          </button>
          {year !== thisYear && (
            <button type="button" className="btn btn-sm" onClick={() => navigate(href.year(thisYear))}>
              This year
            </button>
          )}
        </div>
      </header>
      {query && <SearchBanner key={query} query={query} scope=".year-page" onDone={() => navigate(href.year(year), { replace: true })} />}

      {recap.error ? (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{errorMessage(recap.error)}</span>
        </p>
      ) : !data ? (
        <div className="day-loading" aria-busy="true" />
      ) : (
        <YearContent key={year} recap={data} highlight={highlight} onChanged={recap.reload} />
      )}
    </div>
  );
}

function YearContent({ recap, highlight, onChanged }: { recap: YearRecap; highlight: ParsedSearch | null; onChanged: () => void }) {
  const { format, mood: moodFor } = useApp();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const yearMoods = useQuery(`year:${recap.year}`, () => api.stats.yearInMoods(recap.year), ['entries']);
  useEffect(() => ensureThumbnails(recap.photos), [recap.photos]);

  const top = recap.moodCounts[0];
  const topMoods = recap.moodCounts.filter((c) => top && c.count === top.count);
  const hasReflection = Object.values(recap.reflection).some((answer) => answer.trim());

  if (recap.daysWithEntries === 0 && !hasReflection) {
    return (
      <div className="card empty">
        <div className="art">
          <Sparkles size={64} />
        </div>
        <h2>Nothing saved in {recap.year} yet</h2>
        <p>As you save days — even just a mood — this page gathers your year: its moods, moments, photos and a letter to yourself.</p>
        <a className="btn btn-primary" href={href.today()}>
          Go to today
        </a>
      </div>
    );
  }

  return (
    <>
      <section className="card recorded" aria-labelledby="year-recorded">
        <div className="card-title">
          <h2 id="year-recorded">What I recorded</h2>
          <span className="chip soft-lavender">Recorded data</span>
          <span className="spacer" />
        </div>
        <p className="recorded-note muted">These are simply counts of what you saved — not a judgment of how {recap.year} went.</p>
        <dl className="stat-strip">
          <div>
            <dt>Days with an entry</dt>
            <dd>
              <span className="stat-number numeric">
                <CountUp value={recap.daysWithEntries} />
              </span>
              <span className="stat-of"> of {recap.daysInYear}</span>
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

        {yearMoods.data && (
          <>
            <h3 className="sub-title">A year in moods</h3>
            <YearInMoodsGrid days={yearMoods.data.days} moodFor={(k) => moodFor(k)} formatDay={format.long} formatMonth={monthLabel} />
          </>
        )}
        {recap.moodCounts.length > 0 && (
          <>
            <h3 className="sub-title">Moods this year</h3>
            <MoodBars counts={recap.moodCounts} moodFor={(k) => moodFor(k)} limit={6} />
          </>
        )}
      </section>

      <section className="month-section" aria-labelledby="year-months">
        <div className="section-title">
          <h2 id="year-months">Month by month</h2>
        </div>
        <ul className="year-months stagger">
          {recap.months.map((m) => {
            const mood = moodFor(m.topMood);
            return (
              <li key={m.month}>
                <a className="year-month card" href={href.month(m.month)}>
                  <span className="year-month-name">{formatMonthName(m.month)}</span>
                  <span className="year-month-meta">
                    {mood && <MoodIcon icon={mood.icon} color={mood.color} size={20} title={mood.label} />}
                    <span className="muted">{m.days === 0 ? 'No days saved' : `${m.days} ${m.days === 1 ? 'day' : 'days'}`}</span>
                  </span>
                  {m.intention && <span className="year-month-intention">“{m.intention}”</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {recap.moments.length > 0 && (
        <section className="month-section" aria-labelledby="year-moments">
          <div className="section-title">
            <h2 id="year-moments">Moments of the year</h2>
          </div>
          <ul className="moments stagger">
            {recap.moments.map((moment, i) => {
              const mood = moodFor(moment.mood);
              return (
                <li key={`${moment.date}-${moment.kind}-${i}`}>
                  <a className="moment card" href={href.day(moment.date)}>
                    <span className="moment-reason">
                      <Icon
                        name={moment.kind === 'photos' ? 'memories' : moment.kind === 'longest-entry' ? 'feather' : 'heart'}
                        size={13}
                        filled={moment.kind === 'favorite-day' || moment.kind === 'favorite-answer'}
                      />
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
            <Icon name="info" size={14} /> Moments are picked by the same simple rules as each month: favorite days, answers
            saved as favorite moments, your longest entry and days with three or more photos — spread over the year.
          </p>
        </section>
      )}

      {recap.photos.length > 0 && (
        <section className="month-section" aria-labelledby="year-photos">
          <div className="section-title">
            <h2 id="year-photos">Photos from {recap.year}</h2>
            <span className="count">{recap.photoCount}</span>
            <span className="spacer" />
          </div>
          <ul className="collage stagger">
            {recap.photos.map((photo, i) => (
              <li key={photo.id}>
                <button type="button" className="photo-tile" onClick={() => setLightbox(i)} aria-label={`Open ${photoAlt(photo, format.long(photo.date))}`}>
                  <PhotoImage photo={photo} alt="" />
                </button>
              </li>
            ))}
          </ul>
          {recap.photoCount > recap.photos.length && (
            <a className="btn btn-sm see-all" href={href.memories({ year: String(recap.year) })}>
              See all {recap.photoCount} in Memories
            </a>
          )}
        </section>
      )}

      {recap.tags.length > 0 && (
        <section className="month-section" aria-labelledby="year-tags">
          <div className="section-title">
            <h2 id="year-tags">Tags of the year</h2>
          </div>
          <ul className="tag-list year-tags">
            {recap.tags.map((tag) => (
              <li key={tag.label}>
                <a className="tag-chip" href={href.journal({ tags: tagKey(tag.label), when: `y:${recap.year}` })}>
                  {tag.label} <span className="muted">· {tag.count}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <YearReflection recap={recap} highlight={highlight} />

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

function YearReflection({ recap, highlight }: { recap: YearRecap; highlight: ParsedSearch | null }) {
  const { format } = useApp();
  const [answers, setAnswers] = useState<Record<string, string>>(recap.reflection);
  const year = recap.year;
  const filled = useMemo(() => YEARLY_QUESTIONS.filter((q) => answers[q.key]?.trim()).length, [answers]);

  const update = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    saveQueue.schedule(`year-reflection:${year}:${key}`, async () => {
      await api.years.saveReflection(year, key, value);
      invalidate('reflections');
    });
  };

  return (
    <section className="card reflection" aria-labelledby="year-reflection-title">
      <div className="reflection-head">
        <LetterArt size={58} />
        <div>
          <h2 id="year-reflection-title">My reflection on {year}</h2>
          <p className="muted">
            Your own words about the year. Answer any questions you like — or none.
            {recap.reflectionUpdatedAt && ` Last written ${format.medium(recap.reflectionUpdatedAt.slice(0, 10))}.`}
          </p>
        </div>
        <span className="chip soft-rose reflection-count">
          {filled} of {YEARLY_QUESTIONS.length} answered
        </span>
      </div>

      <div className="reflection-grid stagger">
        {YEARLY_QUESTIONS.map((q) => (
          <label key={q.key} className="reflection-q">
            <span className="reflection-question">{q.text}</span>
            <AutoTextarea value={answers[q.key] ?? ''} highlight={highlight} minRows={2} placeholder="…" onChange={(event) => update(q.key, event.target.value)} />
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
          aria-label={`Letter to myself for ${year}`}
          className="lined letter-text"
          value={answers[YEARLY_LETTER_KEY] ?? ''}
          highlight={highlight}
          minRows={5}
          placeholder={`Write a few lines to yourself about ${year}…`}
          onChange={(event) => update(YEARLY_LETTER_KEY, event.target.value)}
        />
      </div>
    </section>
  );
}
