import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Spinner({ label = 'טוען…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__ring" aria-hidden="true" />
      <span className="spinner__label">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn--ghost" onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  );
}

/** מצב ריק מעוצב — מזמין להוסיף תוכן במקום להציג תוכן מומצא. */
export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art" aria-hidden="true">
        <span className="empty__corner empty__corner--tl" />
        <span className="empty__corner empty__corner--tr" />
        <span className="empty__corner empty__corner--bl" />
        <span className="empty__corner empty__corner--br" />
        <Icon name={icon} size={40} />
      </div>
      <h3 className="empty__title">{title}</h3>
      {text && <p className="empty__text">{text}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal--wide' : ''}`}
      aria-labelledby={titleId}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal__inner">
        <header className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  // הרמז מקושר דרך aria-describedby ולא כחלק מהתווית, כדי שקוראי מסך יקריאו תווית נקייה
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': hint ? hintId : undefined })
    : children;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: IconName; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        <h1 className="page-head__title">
          {icon && <Icon name={icon} size={28} className="page-head__icon" />}
          {title}
        </h1>
        {subtitle && <p className="page-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

export function Ornament() {
  return (
    <svg className="ornament" viewBox="0 0 200 16" aria-hidden="true">
      <path d="M2 8h70M128 8h70" stroke="currentColor" strokeWidth="1" />
      <path d="M100 2l6 6-6 6-6-6z" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="84" cy="8" r="1.6" fill="currentColor" />
      <circle cx="116" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}
