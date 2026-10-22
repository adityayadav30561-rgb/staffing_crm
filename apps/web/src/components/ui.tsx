// Nirman CRM components: pills for actions and status, hairlines not boxes, one action colour.
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import { statusTone, STATUS_LABELS, type AppStatus } from '@crm/shared';
import { initials } from '../lib/format';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'outline';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    icon?: ReactNode;
    loading?: boolean;
    size?: 'sm' | 'md';
  }
>(function Button(
  { variant = 'outline', icon, loading, size = 'md', className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-6 whitespace-nowrap font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-10 py-4 text-10' : 'px-14 py-7 text-11',
        variant === 'primary' && 'rounded-full bg-forest text-mint hover:bg-forest-2',
        variant === 'outline' &&
          'rounded-full bg-surface text-ink-2 ring-1 ring-ink/10 hover:bg-paper hover:text-ink',
        variant === 'ghost' && 'rounded-xs text-ink-2 ring-1 ring-ink/10 hover:bg-paper',
        variant === 'quiet' && 'rounded-full text-ink-2 hover:bg-paper-2 hover:text-ink',
        variant === 'danger' &&
          'rounded-full bg-surface text-signal-red ring-1 ring-signal-red/30 hover:bg-coral-soft',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-14 animate-spin" strokeWidth={1.8} /> : icon}
      {children}
    </button>
  );
});

export const TONES = {
  new: 'bg-mint-soft text-forest',
  neutral: 'bg-paper-2 text-ink-2',
  warn: 'bg-brass-soft text-brass-text',
  info: 'bg-negotiation text-cobalt',
  good: 'bg-mint-soft text-forest',
  bad: 'bg-coral-soft text-coral-2',
  dark: 'bg-forest text-mint',
  lilac: 'bg-lilac-soft text-[#5b45a8]',
} as const;
export type Tone = keyof typeof TONES;

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-4 whitespace-nowrap rounded-full px-8 py-[2px] text-9 font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: AppStatus }) {
  return <Pill tone={statusTone(status)}>{STATUS_LABELS[status]}</Pill>;
}

const AVATAR_TONES = [
  'bg-mint-soft text-forest',
  'bg-forest text-paper',
  'bg-brass-soft text-brass-text',
  'bg-cobalt-soft text-cobalt',
  'bg-coral-soft text-coral-2',
];
export function Avatar({
  name,
  size = 26,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const tone =
    AVATAR_TONES[[...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span
      title={name ?? undefined}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36) }}
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        tone,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Kpi({
  label,
  value,
  note,
  noteTone,
  tint,
  spark,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: 'red';
  tint: 'cobalt' | 'mint' | 'marigold' | 'coral';
  spark?: number[];
}) {
  const bg = {
    cobalt: 'bg-cobalt-soft',
    mint: 'bg-mint-soft',
    marigold: 'bg-marigold-soft',
    coral: 'bg-coral-soft',
  }[tint];
  return (
    <div className={clsx('rounded-lg p-14', bg)}>
      <p className="text-10 text-ink-2">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-8">
        <p className="mock-display tnum text-24">{value}</p>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </div>
      {note != null && (
        <p
          className={clsx(
            'mt-4 text-9',
            noteTone === 'red' ? 'font-medium text-signal-red' : 'text-ink-3',
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

export function Sparkline({
  values,
  width = 80,
  height = 28,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        fill="none"
        stroke="#16181b"
        strokeWidth="1.4"
        points={pts}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card flex min-h-0 flex-col', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-8 px-16 pt-14">
          <h3 className="text-12 font-medium">{title}</h3>
          {action}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1 p-16', title && 'pt-10', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-16 flex flex-wrap items-end justify-between gap-12">
      <div className="min-w-0">
        {subtitle && <p className="text-10 text-ink-3">{subtitle}</p>}
        <h1 className="mock-display text-18">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-8">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? (
        <span className="mt-4 block text-9 text-signal-red">{error}</span>
      ) : hint ? (
        <span className="mt-4 block text-9 text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={clsx('input', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea ref={ref} className={clsx('input min-h-[72px] resize-y', className)} {...rest} />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'input appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-28',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2380868c' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        'inline-flex cursor-pointer items-center gap-8 text-11',
        disabled && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        className="size-14 accent-forest"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={clsx('size-16 animate-spin text-ink-3', className)} strokeWidth={1.8} />
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-8 p-40 text-11 text-ink-3">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 px-24 py-40 text-center">
      {icon && (
        <div className="mb-4 grid size-40 place-items-center rounded-full bg-paper-2 text-ink-3">
          {icon}
        </div>
      )}
      <p className="text-12 font-medium">{title}</p>
      {children && <div className="max-w-[360px] text-10 text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-md bg-coral-soft px-12 py-8 text-10 text-coral-2">
      {(error as Error).message ?? String(error)}
    </p>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-forest-deep/40 p-16 pt-[8vh] animate-pop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="w-full rounded-xl bg-surface shadow-pop"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center justify-between gap-12 border-b hairline px-18 py-14">
          <h2 className="title text-14">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-4 text-ink-3 hover:bg-paper-2 hover:text-ink"
            aria-label="Close"
          >
            <X className="size-16" strokeWidth={1.8} />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-18 py-16">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-8 border-t hairline px-18 py-12">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Right-hand detail panel that slides over the page (record details without leaving the list). */
export function Drawer({
  open,
  onClose,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector('[role=dialog]') && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-forest-deep/20 animate-pop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        className="flex h-full w-full flex-col bg-detail shadow-pop"
        style={{ maxWidth: width }}
      >
        {children}
      </aside>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-4" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'inline-flex items-center gap-6 rounded-full px-12 py-5 text-10 font-medium transition',
            value === it.value
              ? 'bg-forest text-mint'
              : 'text-ink-2 ring-1 ring-ink/10 hover:bg-paper',
          )}
        >
          {it.label}
          {it.count != null && (
            <span
              className={clsx(
                'tnum rounded-full px-6 text-9',
                value === it.value ? 'bg-white/20' : 'bg-paper-2 text-ink-3',
              )}
            >
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Timeline({
  items,
}: {
  items: { id: number; summary: string; createdAt: string; actorName: string | null }[];
}) {
  if (!items.length) return <p className="text-10 text-ink-3">No activity yet.</p>;
  return (
    <ol className="space-y-12">
      {items.map((t) => (
        <li key={t.id} className="relative pl-16">
          <span className="absolute left-0 top-[5px] size-7 rounded-full bg-sage-3" />
          <p className="text-10 leading-snug">{t.summary}</p>
          <p className="text-9 text-ink-3">
            {t.actorName ?? 'System'} ·{' '}
            {new Date(t.createdAt).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-12 gap-y-8 text-10">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('card overflow-x-auto', className)}>
      <table className="w-full border-collapse text-11">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={clsx(
        'whitespace-nowrap border-b hairline bg-detail px-12 py-8 text-left text-9 font-semibold uppercase tracking-[0.06em] text-ink-3',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={clsx('border-b hairline px-12 py-9 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}
