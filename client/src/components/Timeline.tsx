import { motion } from 'motion/react';
import type { JobEvent } from '../api/types';
import { clockTime, dateTime, EVENT_LABEL, relativeTime } from '../lib/format';
import { useServerNow } from '../lib/clock';

const DOT: Record<string, string> = {
  JOB_CREATED: 'border-slate-400',
  JOB_READY: 'border-sky-500',
  NO_ELIGIBLE_RIDER: 'border-rose-500',
  RIDER_ASSIGNED: 'border-amber-500',
  MANUAL_OVERRIDE: 'border-indigo-500',
  RIDER_REASSIGNED: 'border-indigo-500',
  ASSIGNMENT_ACCEPTED: 'border-violet-500',
  ASSIGNMENT_REJECTED: 'border-rose-500',
  ASSIGNMENT_EXPIRED: 'border-rose-500',
  ASSIGNMENT_WITHDRAWN: 'border-rose-500',
  MOVED_TO_MANUAL_QUEUE: 'border-rose-500',
  REQUEUED: 'border-sky-500',
  PICKED_UP: 'border-cyan-500',
  DELIVERED: 'border-emerald-500',
  JOB_CANCELLED: 'border-slate-400',
};

export function Timeline({ events }: { events: JobEvent[] }) {
  const now = useServerNow();
  return (
    <ol className="relative m-0 list-none pl-6 before:absolute before:bottom-1.5 before:left-2 before:top-1.5 before:w-0.5 before:rounded before:bg-gradient-to-b before:from-indigo-300 before:to-transparent">
      {events.map((e, i) => (
        <motion.li
          key={e.id}
          className="relative pb-4"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i, 12) * 0.045 }}
        >
          <span
            className={`absolute -left-[22px] top-[3px] size-3.5 rounded-full border-[3px] bg-white ${DOT[e.type] ?? 'border-indigo-500'}`}
          />
          <div className="font-semibold text-slate-900">{EVENT_LABEL[e.type] ?? e.type}</div>
          <div className="text-xs text-slate-500" title={dateTime(e.at)}>
            {clockTime(e.at)} · {relativeTime(e.at, now)} ·{' '}
            {e.actor
              ? `${e.actor.name}${e.actor.type === 'SYSTEM' ? '' : ` (${e.actor.type.toLowerCase()})`}`
              : 'system'}
          </div>
          {e.message && <div className="mt-0.5 text-[13px] text-slate-700">{e.message}</div>}
          {e.type === 'MANUAL_OVERRIDE' &&
            typeof (e.details as { reason?: unknown } | undefined)?.reason === 'string' && (
              <div className="mt-0.5 text-[13px] text-slate-700">
                Reason: “{(e.details as { reason: string }).reason}”
              </div>
            )}
        </motion.li>
      ))}
    </ol>
  );
}
