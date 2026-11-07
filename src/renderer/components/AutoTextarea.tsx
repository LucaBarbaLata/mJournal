/**
 * A textarea that grows with its content, for writing directly on the page.
 *
 * With `highlight` (a search), the matching words are marked: a mirror of the
 * text sits behind the (transparent) textarea, with the same font, padding and
 * width, and <mark>s where the matches are. The textarea stays fully editable.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { findMatches, type ParsedSearch } from '@core/search';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  minRows?: number;
  highlight?: ParsedSearch | null;
}

/** Computed styles the mirror copies, so its text wraps exactly like the textarea's. */
const MIRRORED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'fontKerning',
  'fontFeatureSettings',
  'fontVariationSettings',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'textAlign',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'direction',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const;

function marked(text: string, search: ParsedSearch): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  findMatches(text, search).forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>);
    at = end;
  });
  // A trailing line break needs something after it to take up its line.
  parts.push(`${text.slice(at)}​`);
  return parts;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea(
  { value, minRows = 2, className = '', highlight = null, ...rest },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLSpanElement>(null);
  useImperativeHandle(forwarded, () => ref.current!);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    });
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, []);

  // Keep the mirror's text laid out exactly like the textarea's.
  useLayoutEffect(() => {
    const el = ref.current;
    const copy = mirror.current;
    if (!highlight || !el || !copy) return;
    const sync = () => {
      const style = getComputedStyle(el);
      for (const property of MIRRORED) copy.style[property] = style[property];
      copy.style.borderStyle = 'solid';
      copy.style.borderColor = 'transparent';
      copy.style.width = `${el.offsetWidth}px`;
      copy.style.height = `${el.offsetHeight}px`;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [highlight, value]);

  const textarea = <textarea ref={ref} value={value} rows={minRows} className={`writing ${className}`} {...rest} />;
  if (!highlight) return textarea;
  return (
    <span className="writing-wrap">
      <span className="writing-highlights" aria-hidden="true" ref={mirror}>
        {marked(value, highlight)}
      </span>
      {textarea}
    </span>
  );
});
