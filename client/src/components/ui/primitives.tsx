import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import type { JobStatus, Priority } from '../../api/types';
import { PRIORITY_UI, STATUS_LABEL, STATUS_UI } from '../../lib/format';
import { cx } from './cls';

export function StatusPill({ status }: { status: JobStatus }) {
  const ui = STATUS_UI[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        ui.pill,
      )}
    >
      <span className={cx('size-1.5 rounded-full', ui.dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const icon =
    priority === 'URGENT' ? '▲▲' : priority === 'HIGH' ? '▲' : priority === 'LOW' ? '▽' : '●';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        PRIORITY_UI[priority],
      )}
    >
      <span className="text-[9px]">{icon}</span>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </span>
  );
}

const VARIANT = {
  default: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  primary:
    'border-transparent bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-600 hover:to-indigo-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
} as const;

interface BtnProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
> {
  variant?: keyof typeof VARIANT;
  size?: 'sm' | 'md';
  busy?: boolean;
}
export function Button({
  variant = 'default',
  size = 'md',
  busy,
  children,
  disabled,
  className,
  ...rest
}: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -1 }}
      disabled={disabled || busy}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-[13px]',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </motion.button>
  );
}

export function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) => Math.round(v));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.8, ease: 'easeOut' });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span>{rounded}</motion.span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-slate-200/70', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <motion.div
      className="px-5 py-10 text-center text-slate-500"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <motion.div
        className="mx-auto mb-3.5 grid size-16 place-items-center rounded-2xl bg-indigo-50 text-indigo-500"
        animate={{ y: [0, -5, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
      >
        {icon ?? <Inbox size={28} />}
      </motion.div>
      <h4 className="mb-1 text-base font-semibold text-slate-900">{title}</h4>
      <div className="mx-auto max-w-md">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="px-5 py-10 text-center text-slate-500" role="alert">
      <div className="mx-auto mb-3.5 grid size-16 place-items-center rounded-2xl bg-rose-50 text-rose-500">
        <AlertTriangle size={28} />
      </div>
      <h4 className="mb-1 text-base font-semibold text-slate-900">Something went wrong</h4>
      <div>{error.message}</div>
      {onRetry && (
        <div className="mt-4">
          <Button onClick={onRetry}>
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    const first =
      bodyRef.current?.querySelector<HTMLElement>('input, select, textarea') ??
      bodyRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-5 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 id={labelId} className="text-lg font-semibold text-slate-900">
                  {title}
                </h3>
                {subtitle && <div className="mt-0.5 text-slate-500">{subtitle}</div>}
              </div>
              <button
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4" ref={bodyRef}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CountdownRing({
  assignedAt,
  expiresAt,
  now,
}: {
  assignedAt: string;
  expiresAt: string;
  now: Date;
}) {
  const total = new Date(expiresAt).getTime() - new Date(assignedAt).getTime();
  const left = Math.max(0, new Date(expiresAt).getTime() - now.getTime());
  const frac = total > 0 ? left / total : 0;
  const R = 32;
  const C = 2 * Math.PI * R;
  const color = frac < 0.15 ? '#f43f5e' : frac < 0.35 ? '#f59e0b' : '#6366f1';
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  return (
    <div
      className="relative size-[74px] flex-none"
      role="timer"
      aria-label="Time left for the rider to confirm"
    >
      <svg width="74" height="74" viewBox="0 0 74 74" className="-rotate-90">
        <circle cx="37" cy="37" r={R} stroke="#e2e8f0" strokeWidth="6" fill="none" />
        <motion.circle
          cx="37"
          cy="37"
          r={R}
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          animate={{ strokeDashoffset: C * (1 - frac) }}
          transition={{ duration: 0.9, ease: 'linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center text-xs font-bold leading-tight text-slate-800">
        <div>
          {left === 0
            ? 'Due'
            : mins >= 60
              ? `${Math.floor(mins / 60)}h ${mins % 60}m`
              : `${mins}:${String(secs).padStart(2, '0')}`}
          <small className="block text-[9.5px] font-medium text-slate-500">to confirm</small>
        </div>
      </div>
    </div>
  );
}
