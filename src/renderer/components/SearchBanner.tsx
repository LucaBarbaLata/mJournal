/**
 * Shown on a page opened from a search: how many matches it has, and buttons to step through them. The
 * matches themselves are marked by the writing fields (AutoTextarea's `highlight`), letters and photo tiles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../lib/motion';
import { Icon } from './Icon';

const MATCHES = '.writing-highlights mark, .letter-body mark, .search-hit';

export function SearchBanner({ query, scope, onDone }: { query: string; scope: string; onDone: () => void }) {
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(-1);
  const shownFirst = useRef(false);

  const marks = useCallback(() => {
    const root = document.querySelector(scope);
    return root ? [...root.querySelectorAll<HTMLElement>(MATCHES)] : [];
  }, [scope]);

  // Count the matches once the page has rendered, and again whenever it changes (typing moves them).
  useEffect(() => {
    const update = () => setCount(marks().length);
    const frame = requestAnimationFrame(update);
    const root = document.querySelector(scope);
    const observer = new MutationObserver(update);
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [query, scope, marks]);

  const go = useCallback(
    (delta: number) => {
      const all = marks();
      if (all.length === 0) return;
      setIndex((current) => {
        const next = (current + delta + all.length) % all.length;
        for (const mark of all) mark.classList.remove('search-current');
        all[next].classList.add('search-current');
        all[next].scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        return next;
      });
    },
    [marks],
  );

  // Bring the first match into view right away.
  useEffect(() => {
    if (count > 0 && !shownFirst.current) {
      shownFirst.current = true;
      go(1);
    }
  }, [count, go]);

  return (
    <div className="search-banner" role="region" aria-label="Search matches">
      <Icon name="search" size={16} />
      <span className="search-banner-text" aria-live="polite">
        {count === 0 ? (
          <>No matches for “{query}” on this page.</>
        ) : (
          <>
            Matches for “<strong>{query}</strong>” · {Math.max(1, index + 1)} of {count}
          </>
        )}
      </span>
      <span className="spacer" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={count < 2} onClick={() => go(-1)}>
        <Icon name="chevron-left" size={15} /> Previous
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={count < 2} onClick={() => go(1)}>
        Next <Icon name="chevron-right" size={15} />
      </button>
      <button type="button" className="btn btn-sm" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
