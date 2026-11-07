/** Journal history and search: every saved day, newest first, with filters. Search runs locally. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchQuery, SearchResult, WritingResult } from '@core/api';
import {
  addMonths,
  firstDayOfMonth,
  isDateKey,
  isMonthKey,
  lastDayOfMonth,
  monthOf,
  parseDateKey,
  weekdayName,
  type DateKey,
} from '@core/dates';
import { energyLabel } from '@core/moods';
import { splitHighlights } from '@core/text';
import { JournalArt } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { MoodIcon } from '../components/MoodIcon';
import { Tip } from '../components/Tip';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useQuery } from '../lib/data';
import { href, navigate } from '../lib/router';
import { useToday } from '../lib/time';
import './journal.css';

type When = '' | 'month' | 'quarter' | 'year' | 'custom' | `m:${string}` | `y:${string}`;

interface Filters {
  q: string;
  moods: string[];
  tags: string[];
  when: When;
  from: string;
  to: string;
  photos: boolean;
  fav: boolean;
  order: 'newest' | 'oldest';
}

function readFilters(params: URLSearchParams): Filters {
  return {
    q: params.get('q') ?? '',
    moods: (params.get('moods') ?? '').split(',').filter(Boolean),
    tags: (params.get('tags') ?? '').split(',').filter(Boolean),
    when: (params.get('when') ?? '') as When,
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    photos: params.get('photos') === '1',
    fav: params.get('fav') === '1',
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
  };
}

function writeFilters(filters: Filters): string {
  return href.journal({
    q: filters.q.trim() || undefined,
    moods: filters.moods.join(','),
    tags: filters.tags.join(','),
    when: filters.when,
    from: filters.when === 'custom' ? filters.from : '',
    to: filters.when === 'custom' ? filters.to : '',
    photos: filters.photos && '1',
    fav: filters.fav && '1',
    order: filters.order === 'oldest' && 'oldest',
  });
}

function dateRange(filters: Filters, today: DateKey): { from?: DateKey; to?: DateKey } {
  const month = monthOf(today);
  if (filters.when === 'month') return { from: firstDayOfMonth(month), to: today };
  if (filters.when === 'quarter') return { from: firstDayOfMonth(addMonths(month, -2)), to: today };
  if (filters.when === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (filters.when.startsWith('m:')) {
    const m = filters.when.slice(2);
    return isMonthKey(m) ? { from: firstDayOfMonth(m), to: lastDayOfMonth(m) } : {};
  }
  if (filters.when.startsWith('y:')) {
    const y = filters.when.slice(2);
    return /^\d{4}$/.test(y) ? { from: `${y}-01-01`, to: `${y}-12-31` } : {};
  }
  if (filters.when === 'custom') {
    return { from: isDateKey(filters.from) ? filters.from : undefined, to: isDateKey(filters.to) ? filters.to : undefined };
  }
  return {};
}

export function JournalView({ params }: { params: URLSearchParams }) {
  const today = useToday();
  const { format, moods, mood: moodFor } = useApp();
  const filters = readFilters(params);
  const [text, setText] = useState(filters.q);
  const [moodMenu, setMoodMenu] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const tagList = useQuery('tags', () => api.tags.list(), ['tags', 'entries']);
  const usedTags = (tagList.data ?? []).filter((t) => t.days > 0 || filters.tags.includes(t.name));
  const [extra, setExtra] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState<DateKey | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<Filters>) => navigate(writeFilters({ ...filters, ...patch }), { replace: true });

  // The address is the source of truth; typing updates it after a short pause.
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const timer = window.setTimeout(() => update({ q: text }), 250);
    return () => window.clearTimeout(timer);
    // Only typing should restart the pause.
  }, [text]);

  useEffect(() => {
    if (params.get('focus')) searchRef.current?.focus();
  }, [params]);

  const range = dateRange(filters, today);
  const query: SearchQuery = {
    text: filters.q || undefined,
    from: range.from,
    to: range.to,
    moods: filters.moods.length ? filters.moods : undefined,
    tags: filters.tags.length ? filters.tags : undefined,
    withPhotos: filters.photos || undefined,
    favoritesOnly: filters.fav || undefined,
    order: filters.order,
    limit: 30,
  };
  const queryKey = JSON.stringify(query);
  const page = useQuery(`search:${queryKey}`, () => api.journal.search(query), ['entries']);
  // Reflections and opened letters are searched too, when the search is only words (the other filters are about days).
  const textOnly = Boolean(filters.q) && !filters.moods.length && !filters.tags.length && !filters.photos && !filters.fav;
  const writing = useQuery(
    `writing:${textOnly ? filters.q : ''}:${range.from ?? ''}:${range.to ?? ''}`,
    () => (textOnly ? api.journal.searchWriting({ text: filters.q, from: range.from, to: range.to }) : Promise.resolve([])),
    ['reflections', 'capsules'],
  );
  const writingResults = textOnly ? (writing.data ?? []) : [];
  const writingTitle = (w: WritingResult) =>
    w.kind === 'month'
      ? `Monthly reflection · ${format.monthYear(w.ref)}`
      : w.kind === 'year'
        ? `Year in review · ${w.ref}`
        : `Letter written on ${format.long(w.writtenOn ?? '')} · opened ${format.medium(w.openOn ?? '')}`;
  const writingLink = (w: WritingResult) =>
    w.kind === 'month' ? href.month(w.ref, filters.q) : w.kind === 'year' ? href.year(Number(w.ref), filters.q) : href.day(w.openOn ?? '', filters.q);
  const months = useQuery('journal-months', () => api.journal.months(), ['entries']);
  const years = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of months.data ?? []) counts.set(m.month.slice(0, 4), (counts.get(m.month.slice(0, 4)) ?? 0) + m.count);
    return [...counts.entries()];
  }, [months.data]);

  useEffect(() => {
    setExtra([]);
    setCursor(null);
    setMoreError(null);
  }, [queryKey, page.data]);

  const results = useMemo(() => [...(page.data?.results ?? []), ...extra], [page.data, extra]);
  const nextCursor = cursor ?? page.data?.nextCursor ?? null;
  const hasMore = extra.length > 0 ? cursor !== null : (page.data?.nextCursor ?? null) !== null;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await api.journal.search({ ...query, cursor: nextCursor });
      setExtra((items) => [...items, ...next.results]);
      setCursor(next.nextCursor);
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const m = monthOf(r.date);
      map.set(m, [...(map.get(m) ?? []), r]);
    }
    return [...map.entries()];
  }, [results]);

  const active = Boolean(filters.q || filters.moods.length || filters.tags.length || filters.when || filters.photos || filters.fav);
  const total = page.data?.total ?? 0;

  return (
    <div className="page journal-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Journal</p>
          <h1>Your pages</h1>
          <p className="subtitle muted">Browse, search and rediscover. Search happens on this computer only.</p>
        </div>
      </header>

      <Tip id="journal" icon="search">
        <strong>Tip:</strong> search a word, a feeling or a place — it looks through your writing, answers, mood notes and
        photo captions, right here on this computer.
      </Tip>

      <div className="search-panel card">
        <div className="search-box">
          <Icon name="search" size={20} />
          <input
            ref={searchRef}
            type="search"
            className="search-input"
            placeholder="Search words, moments, captions…"
            aria-label="Search your journal"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ q: text });
            }}
          />
          {text && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear search"
              onClick={() => {
                setText('');
                update({ q: '' });
              }}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        <div className="filter-row" role="group" aria-label="Filters">
          <div className="filter-menu">
            <button
              type="button"
              className="chip"
              aria-pressed={filters.moods.length > 0}
              aria-expanded={moodMenu}
              onClick={() => setMoodMenu(!moodMenu)}
            >
              Mood{filters.moods.length ? ` · ${filters.moods.length}` : ''} <Icon name="chevron-down" size={13} />
            </button>
            {moodMenu && (
              <div className="popover mood-menu" role="group" aria-label="Filter by mood" onKeyDown={(e) => e.key === 'Escape' && setMoodMenu(false)}>
                {moods.map((mood) => (
                  <label key={mood.key} className="check mood-menu-item">
                    <input
                      type="checkbox"
                      checked={filters.moods.includes(mood.key)}
                      onChange={(event) =>
                        update({
                          moods: event.target.checked
                            ? [...filters.moods, mood.key]
                            : filters.moods.filter((m) => m !== mood.key),
                        })
                      }
                    />
                    <MoodIcon icon={mood.icon} color={mood.color} size={20} /> {mood.label}
                    {mood.hidden && <span className="muted">(hidden)</span>}
                  </label>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => setMoodMenu(false)}>
                  Done
                </button>
              </div>
            )}
          </div>

          {usedTags.length > 0 && (
            <div className="filter-menu">
              <button
                type="button"
                className="chip"
                aria-pressed={filters.tags.length > 0}
                aria-expanded={tagMenu}
                onClick={() => setTagMenu(!tagMenu)}
              >
                <Icon name="tag" size={13} /> Tags{filters.tags.length ? ` · ${filters.tags.length}` : ''} <Icon name="chevron-down" size={13} />
              </button>
              {tagMenu && (
                <div className="popover mood-menu tag-menu" role="group" aria-label="Filter by tag" onKeyDown={(e) => e.key === 'Escape' && setTagMenu(false)}>
                  {usedTags.map((tag) => (
                    <label key={tag.name} className="check mood-menu-item">
                      <input
                        type="checkbox"
                        checked={filters.tags.includes(tag.name)}
                        onChange={(event) =>
                          update({
                            tags: event.target.checked ? [...filters.tags, tag.name] : filters.tags.filter((t) => t !== tag.name),
                          })
                        }
                      />
                      {tag.label} <span className="muted">({tag.days})</span>
                    </label>
                  ))}
                  <button type="button" className="btn btn-sm" onClick={() => setTagMenu(false)}>
                    Done
                  </button>
                </div>
              )}
            </div>
          )}

          <label className="visually-hidden" htmlFor="when-filter">
            When
          </label>
          <select
            id="when-filter"
            className="select select-chip"
            value={filters.when}
            onChange={(event) => update({ when: event.target.value as When })}
          >
            <option value="">Any time</option>
            <option value="month">This month</option>
            <option value="quarter">Last 3 months</option>
            <option value="year">This year</option>
            {years.length > 0 && (
              <optgroup label="A specific year">
                {years.map(([year, count]) => (
                  <option key={year} value={`y:${year}`}>
                    {year} ({count})
                  </option>
                ))}
              </optgroup>
            )}
            {(months.data ?? []).length > 0 && (
              <optgroup label="A specific month">
                {months.data!.map((m) => (
                  <option key={m.month} value={`m:${m.month}`}>
                    {format.monthYear(m.month)} ({m.count})
                  </option>
                ))}
              </optgroup>
            )}
            <option value="custom">Choose dates…</option>
          </select>
          {filters.when === 'custom' && (
            <span className="date-range">
              <label>
                <span className="visually-hidden">From</span>
                <input type="date" className="input" value={filters.from} max={today} onChange={(e) => update({ from: e.target.value })} />
              </label>
              <span aria-hidden="true">–</span>
              <label>
                <span className="visually-hidden">To</span>
                <input type="date" className="input" value={filters.to} max={today} onChange={(e) => update({ to: e.target.value })} />
              </label>
            </span>
          )}
          <button type="button" className="chip" aria-pressed={filters.photos} onClick={() => update({ photos: !filters.photos })}>
            <Icon name="memories" size={14} /> With photos
          </button>
          <button type="button" className="chip" aria-pressed={filters.fav} onClick={() => update({ fav: !filters.fav })}>
            <Icon name="heart" size={14} filled={filters.fav} /> Favorites
          </button>
          <span className="filter-spacer" />
          <label className="visually-hidden" htmlFor="order-filter">
            Order
          </label>
          <select
            id="order-filter"
            className="select select-chip"
            value={filters.order}
            onChange={(event) => update({ order: event.target.value as Filters['order'] })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        {active && (
          <p className="result-summary" role="status">
            {page.data ? `${total} ${total === 1 ? 'day' : 'days'} found` : 'Searching…'}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setText('');
                navigate(href.journal(), { replace: true });
              }}
            >
              Clear filters
            </button>
          </p>
        )}
      </div>

      {page.error ? (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{errorMessage(page.error)}</span>
        </p>
      ) : page.data && results.length === 0 && writingResults.length === 0 ? (
        <div className="empty">
          <div className="art">
            <JournalArt />
          </div>
          {active ? (
            <>
              <h2>Nothing matches yet</h2>
              <p>Try a different word, or fewer filters.</p>
            </>
          ) : (
            <>
              <h2>Your journal is waiting for its first page</h2>
              <p>Everything you save — a mood, a few words, a photo — will gather here, newest first.</p>
              <a className="btn btn-primary" href={href.today()}>
                Write today’s page
              </a>
            </>
          )}
        </div>
      ) : (
        <>
          {writingResults.length > 0 && (
            <section className="result-group writing-results" aria-labelledby="writing-results">
              <h2 id="writing-results" className="group-title">
                In your reflections and letters
                <span className="count">{writingResults.length}</span>
              </h2>
              <ul className="result-list">
                {writingResults.map((w) => (
                  <li key={`${w.kind}-${w.ref}`}>
                    <a className="result" href={writingLink(w)}>
                      <span className="result-date writing-kind" aria-hidden="true">
                        <Icon name={w.kind === 'capsule' ? 'envelope' : w.kind === 'year' ? 'star' : 'month'} size={20} />
                      </span>
                      <span className="result-body">
                        <span className="result-meta">
                          <span>{writingTitle(w)}</span>
                        </span>
                        <span className="result-excerpt">
                          {splitHighlights(w.snippet).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={18} className="result-arrow" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {groups.map(([month, items]) => (
          <section key={month} className="result-group" aria-labelledby={`group-${month}`}>
            <h2 id={`group-${month}`} className="group-title">
              {format.monthYear(month)}
              <span className="count">{items.length}</span>
            </h2>
            <ul className="result-list stagger">
              {items.map((r) => {
                const mood = moodFor(r.mood);
                return (
                  <li key={r.date}>
                    <a className="result" href={href.day(r.date, filters.q || null)}>
                      <span className="result-date" aria-hidden="true">
                        <span className="result-day">{parseDateKey(r.date).day}</span>
                        <span className="result-weekday">{weekdayName(r.date, 'short')}</span>
                      </span>
                      <span className="result-body">
                        <span className="result-meta">
                          <span className="visually-hidden">{format.long(r.date)}.</span>
                          {mood && (
                            <span className="result-mood">
                              <MoodIcon icon={mood.icon} color={mood.color} size={18} /> {mood.label}
                            </span>
                          )}
                          {r.energy && <span>Energy {energyLabel(r.energy)?.toLowerCase()}</span>}
                          {r.wordCount > 0 && <span>{r.wordCount} words</span>}
                          {r.photoCount > 0 && (
                            <span>
                              <Icon name="memories" size={13} /> {r.photoCount}
                            </span>
                          )}
                          {r.favorite && (
                            <span className="result-fav">
                              <Icon name="heart" size={13} filled /> Favorite
                            </span>
                          )}
                          {r.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="result-tag">
                              {tag}
                            </span>
                          ))}
                          {r.tags.length > 3 && <span className="muted">+{r.tags.length - 3}</span>}
                        </span>
                        <span className="result-excerpt">
                          {r.snippet
                            ? splitHighlights(r.snippet).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))
                            : r.excerpt || <span className="muted">{mood ? `Felt ${mood.label.toLowerCase()}.` : 'A saved day.'}</span>}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={18} className="result-arrow" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        </>
      )}

      {hasMore && (
        <div className="load-more">
          <button type="button" className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <span className="spinner" aria-hidden="true" /> : null} Show more
          </button>
          {moreError && <p className="muted">{moreError}</p>}
        </div>
      )}
    </div>
  );
}
