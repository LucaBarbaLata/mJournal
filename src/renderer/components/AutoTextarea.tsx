/** A textarea that grows with its content, for writing directly on the page. */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  minRows?: number;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea(
  { value, minRows = 2, className = '', ...rest },
  forwarded,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
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

  return <textarea ref={ref} value={value} rows={minRows} className={`writing ${className}`} {...rest} />;
});
