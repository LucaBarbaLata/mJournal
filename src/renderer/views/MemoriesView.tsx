/**
 * The memory gallery: every photo, by month, like a scrapbook. Photos load a
 * page at a time (more come as you scroll), so large libraries stay quick.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GalleryPhoto } from '@core/api';
import { formatMonthName, lastDayOfMonth, makeMonthKey, monthOf } from '@core/dates';
import { GALLERY_PAGE_SIZE } from '@core/photos';
import { hashString } from '@core/promptSelection';
import { PhotosArt } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { Lightbox } from '../components/Lightbox';
import { PhotoImage, photoAlt } from '../components/Photo';
import { Tip } from '../components/Tip';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useQuery } from '../lib/data';
import { href, navigate } from '../lib/router';
import { ensureThumbnails } from '../lib/thumbnails';
import './memories.css';

export function MemoriesView({ params }: { params: URLSearchParams }) {
  const { format } = useApp();
  const year = params.get('year') ?? '';
  const month = params.get('month') ?? '';
  const months = useQuery('gallery-months', () => api.photos.galleryMonths(), ['photos', 'entries']);

  const from = year ? `${year}-${month || '01'}-01` : undefined;
  const to = year ? (month ? lastDayOfMonth(`${year}-${month}`) : `${year}-12-31`) : undefined;
  // How many pages are shown. Reloads ask for all of them again, so the list never jumps back to the top.
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [from, to]);
  const limit = pages * GALLERY_PAGE_SIZE;
  const photos = useQuery(`gallery:${from}:${to}:${limit}`, () => api.photos.gallery({ from, to, limit }), [
    'photos',
    'entries',
  ]);
  const [open, setOpen] = useState<number | null>(null);
  const hasMore = photos.data?.hasMore ?? false;
  const showMore = () => {
    if (hasMore && !photos.loading) setPages((n) => n + 1);
  };

  useEffect(() => {
    if (photos.data) ensureThumbnails(photos.data.photos);
  }, [photos.data]);

  // Load the next page when the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const showMoreRef = useRef(showMore);
  showMoreRef.current = showMore;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((items) => {
      if (items.some((item) => item.isIntersecting)) showMoreRef.current();
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, limit]);

  const years = useMemo(() => [...new Set((months.data ?? []).map((m) => m.month.slice(0, 4)))], [months.data]);
  const monthsInYear = useMemo(
    () => (months.data ?? []).filter((m) => m.month.startsWith(`${year}-`)).map((m) => m.month.slice(5)),
    [months.data, year],
  );
  const list = photos.data?.photos ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, { photo: GalleryPhoto; index: number }[]>();
    list.forEach((photo, index) => {
      const m = monthOf(photo.date);
      map.set(m, [...(map.get(m) ?? []), { photo, index }]);
    });
    return [...map.entries()];
  }, [list]);
  const total = (months.data ?? []).reduce((n, m) => n + m.count, 0);

  const setFilter = (nextYear: string, nextMonth: string) =>
    navigate(href.memories({ year: nextYear || undefined, month: nextYear && nextMonth ? nextMonth : undefined }), { replace: true });

  return (
    <div className="page memories-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Memories</p>
          <h1>Little moments, kept</h1>
          <p className="subtitle muted">
            {total === 0 ? 'Photos you add to your days will gather here.' : `${total} ${total === 1 ? 'photo' : 'photos'} in your journal`}
          </p>
        </div>
        {years.length > 0 && (
          <div className="page-actions">
            <label className="visually-hidden" htmlFor="memories-year">
              Year
            </label>
            <select id="memories-year" className="select select-chip" value={year} onChange={(e) => setFilter(e.target.value, '')}>
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {year && (
              <>
                <label className="visually-hidden" htmlFor="memories-month">
                  Month
                </label>
                <select id="memories-month" className="select select-chip" value={month} onChange={(e) => setFilter(year, e.target.value)}>
                  <option value="">All months</option>
                  {monthsInYear.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthName(makeMonthKey(Number(year), Number(m)))}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
      </header>

      {list.length > 0 && (
        <Tip id="memories" icon="memories">
          <strong>Tip:</strong> click a photo to see it larger, add a caption or jump to its day. The arrow keys move between
          photos.
        </Tip>
      )}

      {photos.error ? (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{errorMessage(photos.error)}</span>
        </p>
      ) : photos.data && list.length === 0 ? (
        <div className="empty">
          <div className="art">
            <PhotosArt />
          </div>
          <h2>{year ? 'No photos in this period' : 'Your memories will gather here'}</h2>
          <p>
            {year
              ? 'Try another month or year.'
              : 'Add a photo to any day — a sunset, a snack, a friend — and it will appear here, by date.'}
          </p>
          {!year && (
            <a className="btn btn-primary" href={href.today()}>
              <Icon name="image-plus" size={16} /> Add a photo to today
            </a>
          )}
        </div>
      ) : (
        groups.map(([m, items]) => (
          <section key={m} className="memory-month" aria-labelledby={`mem-${m}`}>
            <h2 id={`mem-${m}`} className="group-title">
              {format.monthYear(m)} <span className="count">{items.length}</span>
            </h2>
            <ul className="polaroids">
              {items.map(({ photo, index }) => {
                const tilt = ((hashString(photo.id) % 7) - 3) * 0.45;
                return (
                  <li key={photo.id} style={{ '--tilt': `${tilt}deg` } as CSSProperties}>
                    <button type="button" className="polaroid" onClick={() => setOpen(index)} aria-label={`Open ${photoAlt(photo, format.long(photo.date))}`}>
                      <span className="polaroid-photo">
                        <PhotoImage photo={photo} alt="" />
                      </span>
                      <span className="polaroid-caption">
                        <span className="polaroid-date">{format.dayMonth(photo.date)}</span>
                        {photo.caption && <span className="polaroid-text">{photo.caption}</span>}
                      </span>
                      {photo.favorite && (
                        <span className="photo-fav" aria-hidden="true">
                          <Icon name="heart" size={12} filled />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {hasMore && (
        <div className="load-more" ref={sentinel}>
          <button type="button" className="btn" onClick={showMore} disabled={photos.loading}>
            {photos.loading ? <span className="spinner" aria-hidden="true" /> : null} Show more photos
          </button>
        </div>
      )}

      {open !== null && list[open] && (
        <Lightbox
          photos={list}
          index={open}
          onIndexChange={(index) => {
            setOpen(index);
            // Near the end of what's loaded, fetch the next page so the arrows keep going.
            if (index >= list.length - 3) showMore();
          }}
          onClose={() => setOpen(null)}
          onChanged={() => {
            photos.reload();
            months.reload();
          }}
          showOpenDay
        />
      )}
    </div>
  );
}
