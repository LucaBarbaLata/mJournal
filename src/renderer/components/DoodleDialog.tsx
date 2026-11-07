/**
 * A small drawing for the day: draw with a mouse, a pen (pressure changes the line) or a finger on a cream sheet,
 * then keep it as a photo of the day. It goes through the usual photo import, so Memories, backups and
 * thumbnails treat it like any other picture.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImportResult } from '@core/api';
import type { DateKey } from '@core/dates';
import { api, errorMessage } from '../lib/api';
import { confirm, Dialog } from './Dialog';
import { Icon } from './Icon';

/** The drawing's size in pixels (3:2). It's shown smaller and stored at this size. */
const WIDTH = 1200;
const HEIGHT = 800;
/** The sheet is always cream, whatever the theme, so the inks read the same everywhere. */
const PAPER = '#fffaf2';
const INKS = [
  { name: 'Ink', color: '#3a2e38' },
  { name: 'Rose', color: '#b8667a' },
  { name: 'Lavender', color: '#6c56a0' },
  { name: 'Sage', color: '#52704c' },
  { name: 'Peach', color: '#c47a4a' },
  { name: 'Sky', color: '#4f7fb5' },
] as const;
const SIZES = [
  { name: 'Fine', width: 3 },
  { name: 'Medium', width: 7 },
  { name: 'Bold', width: 16 },
] as const;

interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  /** x, y and pen pressure (0–1; 0.5 for a mouse). */
  points: [number, number, number][];
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.strokeStyle = stroke.erase ? PAPER : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const widthAt = (pressure: number) => stroke.width * (stroke.erase ? 2.5 : 0.55 + pressure * 0.9);
  const points = stroke.points;
  if (points.length === 1) {
    const [x, y, p] = points[0];
    ctx.beginPath();
    ctx.arc(x, y, widthAt(p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Short smoothed segments, each with the width of its pressure.
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1, p1] = points[i];
    const [x2, y2] = points[i + 1] ?? points[i];
    ctx.lineWidth = widthAt(p1);
    ctx.beginPath();
    ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
    ctx.stroke();
  }
}

export function DoodleDialog({
  open,
  date,
  onClose,
  onSaved,
}: {
  open: boolean;
  date: DateKey;
  onClose: () => void;
  onSaved: (result: ImportResult) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [ink, setInk] = useState<string>(INKS[0].color);
  const [size, setSize] = useState<number>(SIZES[1].width);
  const [erasing, setErasing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redraw = useCallback((all: Stroke[]) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const stroke of all) drawStroke(ctx, stroke);
  }, []);

  useEffect(() => {
    if (open) redraw(strokes);
    // Only when the dialog opens: while drawing, strokes are drawn as they grow.
  }, [open]);

  const reset = () => {
    setStrokes([]);
    current.current = null;
    setError(null);
  };

  const close = async () => {
    if (strokes.length > 0 && !busy) {
      const ok = await confirm({ title: 'Put this drawing away?', body: 'It hasn’t been kept yet.', confirmLabel: 'Don’t keep it', tone: 'danger' });
      if (!ok) return;
    }
    reset();
    onClose();
  };

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    const pressure = event.pointerType === 'pen' ? Math.max(0.05, event.pressure) : 0.5;
    return [((event.clientX - box.left) / box.width) * WIDTH, ((event.clientY - box.top) / box.height) * HEIGHT, pressure];
  };

  const undo = () => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    redraw(next);
  };

  const clear = () => {
    setStrokes([]);
    redraw([]);
  };

  const save = async () => {
    const el = canvas.current;
    if (!el || strokes.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, 'image/png'));
      if (!blob) {
        setError('The drawing couldn’t be turned into a picture. Please try again.');
        return;
      }
      const now = new Date();
      const stamp = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const result = await api.photos.importData(date, [
        { name: `doodle-${date}-${stamp}.png`, data: new Uint8Array(await blob.arrayBuffer()) },
      ]);
      if (result.imported.length === 0) {
        // For example: the day already holds as many photos as it can.
        setError(result.rejected[0]?.reason ?? 'The drawing couldn’t be kept. Please try again.');
        return;
      }
      onSaved(result);
      reset();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => void close()}
      dismissible={!busy}
      wide
      title="Draw something"
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => void close()} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || strokes.length === 0}>
            {busy && <span className="spinner" aria-hidden="true" />} Keep it with this day
          </button>
        </>
      }
    >
      <div className="doodle">
        <div className="doodle-tools">
          <div className="doodle-inks" role="radiogroup" aria-label="Ink">
            {INKS.map((option) => (
              <button
                key={option.color}
                type="button"
                role="radio"
                aria-checked={!erasing && ink === option.color}
                aria-label={option.name}
                title={option.name}
                className="doodle-ink"
                style={{ background: option.color }}
                onClick={() => {
                  setInk(option.color);
                  setErasing(false);
                }}
              />
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Line">
            {SIZES.map((option) => (
              <button key={option.name} type="button" role="radio" aria-checked={size === option.width} onClick={() => setSize(option.width)}>
                {option.name}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" aria-pressed={erasing} onClick={() => setErasing(!erasing)}>
            <Icon name="eraser" size={15} /> Eraser
          </button>
          <span className="doodle-history">
            <button type="button" className="btn btn-sm btn-ghost" disabled={strokes.length === 0} onClick={undo}>
              <Icon name="undo" size={15} /> Undo
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={strokes.length === 0} onClick={clear}>
              <Icon name="trash" size={15} /> Clear
            </button>
          </span>
        </div>
        <canvas
          ref={canvas}
          className="doodle-canvas"
          width={WIDTH}
          height={HEIGHT}
          role="img"
          aria-label="Drawing area: draw with a mouse, pen or finger"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            event.currentTarget.setPointerCapture(event.pointerId);
            current.current = { color: ink, width: size, erase: erasing, points: [point(event)] };
            const ctx = canvas.current?.getContext('2d');
            if (ctx) drawStroke(ctx, current.current);
          }}
          onPointerMove={(event) => {
            const stroke = current.current;
            if (!stroke) return;
            stroke.points.push(point(event));
            const ctx = canvas.current?.getContext('2d');
            if (ctx) drawStroke(ctx, { ...stroke, points: stroke.points.slice(-3) });
          }}
          onPointerUp={() => {
            const stroke = current.current;
            current.current = null;
            if (stroke) setStrokes((all) => [...all, stroke]);
          }}
          onPointerCancel={() => {
            current.current = null;
            redraw(strokes);
          }}
          onKeyDown={(event) => {
            if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              undo();
            }
          }}
          tabIndex={0}
        />
        <p className="muted doodle-hint">Draw with a mouse, a pen or your finger. It’s kept as a picture with this day’s photos.</p>
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
