/** Quiet confirmations after explicit actions (backups, exports). Never used for nudges. */
import { useSyncExternalStore } from 'react';
import { reducedMotion } from '../lib/motion';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  leaving?: boolean;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, action?: Toast['action'], durationMs = 6000): void {
  const item = { id: nextId++, message, action };
  toasts = [...toasts.slice(-2), item];
  emit();
  window.setTimeout(() => dismiss(item.id), durationMs);
}

/** Lets the toast ease out before it is removed. */
function dismiss(id: number): void {
  if (!toasts.some((t) => t.id === id && !t.leaving)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  window.setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    reducedMotion() ? 0 : 220,
  );
}

export function ToastHost() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div className={`toast${t.leaving ? ' leaving' : ''}`} key={t.id}>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
