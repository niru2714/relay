import type { AssignmentStatus, JobStatus, Priority } from '../api/types';

export const STATUS_LABEL: Record<JobStatus, string> = {
  NEW: 'New',
  READY_FOR_ASSIGNMENT: 'Ready to assign',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  ACCEPTED: 'Accepted',
  PICKED_UP: 'In transit',
  DELIVERED: 'Delivered',
  MANUAL_QUEUE: 'Manual queue',
  CANCELLED: 'Cancelled',
};

export const STATUS_UI: Record<
  JobStatus,
  { pill: string; dot: string; hex: string; text: string }
> = {
  NEW: {
    pill: 'bg-slate-100 text-slate-700 ring-slate-200',
    dot: 'bg-slate-400',
    hex: '#94a3b8',
    text: 'text-slate-600',
  },
  READY_FOR_ASSIGNMENT: {
    pill: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
    hex: '#0ea5e9',
    text: 'text-sky-600',
  },
  AWAITING_CONFIRMATION: {
    pill: 'bg-amber-50 text-amber-700 ring-amber-200',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
    text: 'text-amber-600',
  },
  ACCEPTED: {
    pill: 'bg-violet-50 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
    hex: '#8b5cf6',
    text: 'text-violet-600',
  },
  PICKED_UP: {
    pill: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    dot: 'bg-cyan-500',
    hex: '#06b6d4',
    text: 'text-cyan-600',
  },
  DELIVERED: {
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    hex: '#10b981',
    text: 'text-emerald-600',
  },
  MANUAL_QUEUE: {
    pill: 'bg-rose-50 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
    hex: '#f43f5e',
    text: 'text-rose-600',
  },
  CANCELLED: {
    pill: 'bg-slate-100 text-slate-500 ring-slate-200',
    dot: 'bg-slate-400',
    hex: '#94a3b8',
    text: 'text-slate-500',
  },
};

export const PRIORITY_UI: Record<Priority, string> = {
  LOW: 'bg-slate-50 text-slate-500 ring-slate-200',
  NORMAL: 'bg-sky-50 text-sky-700 ring-sky-200',
  HIGH: 'bg-amber-50 text-amber-700 ring-amber-200',
  URGENT: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Timed out',
  WITHDRAWN: 'Withdrawn',
  REASSIGNED: 'Reassigned',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

export const MANUAL_REASON_LABEL: Record<string, string> = {
  ASSIGNMENT_TIMEOUT: 'Rider did not confirm in time',
  RIDER_REJECTED: 'Rider rejected the assignment',
  RIDER_WITHDREW: 'Rider withdrew after accepting',
  DISPATCHER_ESCALATION: 'Escalated by a dispatcher',
  ORPHANED_ASSIGNMENT: 'Assignment record was inconsistent',
};

export const EVENT_LABEL: Record<string, string> = {
  JOB_CREATED: 'Job created',
  JOB_READY: 'Ready for dispatch',
  NO_ELIGIBLE_RIDER: 'No eligible rider',
  RIDER_ASSIGNED: 'Rider assigned',
  MANUAL_OVERRIDE: 'Manual override',
  RIDER_REASSIGNED: 'Rider reassigned',
  ASSIGNMENT_ACCEPTED: 'Rider confirmed',
  ASSIGNMENT_REJECTED: 'Rider rejected',
  ASSIGNMENT_EXPIRED: 'Assignment timed out',
  ASSIGNMENT_WITHDRAWN: 'Rider withdrew',
  MOVED_TO_MANUAL_QUEUE: 'Moved to manual queue',
  REQUEUED: 'Returned to dispatch pool',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  JOB_CANCELLED: 'Cancelled',
};

export function relativeTime(iso: string | Date, now: Date): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const unit =
    abs < 60
      ? [Math.round(abs), 's']
      : abs < 3600
        ? [Math.round(abs / 60), 'm']
        : abs < 86400
          ? [Math.round(abs / 3600), 'h']
          : [Math.round(abs / 86400), 'd'];
  return diff >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}

export const clockTime = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dateTime = (iso: string | Date): string =>
  new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
};

export const initials = (name: string): string =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
