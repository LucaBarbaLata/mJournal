/** Accessible modal dialogs built on <dialog> (focus is trapped and Escape closes). */
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  /** Whether clicking outside or pressing Escape closes the dialog. */
  dismissible?: boolean;
}

export function Dialog({ open, onClose, title, children, actions, wide = false, dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="dialog-body">
            <h2 id={titleId}>{title}</h2>
            {children}
          </div>
          {actions && <div className="dialog-actions">{actions}</div>}
          {dismissible && (
            <button type="button" className="icon-btn dialog-close" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// confirm(): a promise-based confirmation dialog.

interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  resolve: (ok: boolean) => void;
}

let pending: ConfirmRequest | null = null;
const confirmListeners = new Set<() => void>();
const emitConfirm = () => confirmListeners.forEach((l) => l());

export function confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...request, resolve };
    emitConfirm();
  });
}

export function ConfirmHost() {
  const request = useSyncExternalStore(
    (l) => {
      confirmListeners.add(l);
      return () => confirmListeners.delete(l);
    },
    () => pending,
  );
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    pending = null;
    emitConfirm();
  };
  return (
    <Dialog
      open={request !== null}
      onClose={() => finish(false)}
      title={request?.title ?? ''}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => finish(false)}>
            {request?.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${request?.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => finish(true)}
            autoFocus
          >
            {request?.confirmLabel}
          </button>
        </>
      }
    >
      {typeof request?.body === 'string' ? <p className="muted">{request.body}</p> : request?.body}
    </Dialog>
  );
}
