import { motion } from 'motion/react';
import { Check, Siren, XCircle } from 'lucide-react';
import type { JobStatus } from '../api/types';
import { STATUS_LABEL, STATUS_UI } from '../lib/format';
import { banner, cx } from './ui/cls';

const FLOW: JobStatus[] = [
  'NEW',
  'READY_FOR_ASSIGNMENT',
  'AWAITING_CONFIRMATION',
  'ACCEPTED',
  'PICKED_UP',
  'DELIVERED',
];

export function LifecycleStepper({ status }: { status: JobStatus }) {
  const branch = status === 'MANUAL_QUEUE' || status === 'CANCELLED';
  const idx = branch ? (status === 'MANUAL_QUEUE' ? 2 : -1) : FLOW.indexOf(status);
  return (
    <div>
      <div
        className="flex items-start overflow-x-auto pb-0.5 pt-1.5"
        role="list"
        aria-label="Job lifecycle"
      >
        {FLOW.map((s, i) => {
          const done = i < idx || status === 'DELIVERED';
          const now = i === idx && !branch;
          return (
            <div
              key={s}
              role="listitem"
              aria-current={now ? 'step' : undefined}
              className={cx(
                'relative flex min-w-24 flex-1 flex-col items-center gap-2 text-center text-[11.5px] font-semibold',
                now ? 'text-slate-900' : done ? 'text-slate-600' : 'text-slate-400',
              )}
            >
              <motion.div
                className={cx(
                  'z-10 grid size-7 place-items-center rounded-full border-2 bg-white',
                  done
                    ? 'border-emerald-500 !bg-emerald-500 text-white'
                    : now
                      ? 'border-indigo-500 text-indigo-600 ring-4 ring-indigo-100'
                      : 'border-slate-200',
                )}
                animate={{ scale: now ? [1, 1.12, 1] : 1 }}
                transition={{ repeat: now ? Infinity : 0, duration: 2 }}
              >
                {done ? (
                  <Check size={14} />
                ) : now ? (
                  <span className={cx('size-2 rounded-full', STATUS_UI[s].dot)} />
                ) : null}
              </motion.div>
              {STATUS_LABEL[s]}
              {i < FLOW.length - 1 && (
                <div className="absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-3 h-0.5 rounded bg-slate-200">
                  <motion.div
                    className="h-full origin-left rounded bg-emerald-500"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={{ duration: 0.6, delay: i * 0.08 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {branch && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cx('mt-3', status === 'MANUAL_QUEUE' ? banner.critical : banner.info)}
        >
          {status === 'MANUAL_QUEUE' ? <Siren size={16} /> : <XCircle size={16} />}
          <span>
            {status === 'MANUAL_QUEUE'
              ? 'This job left the normal flow and is waiting in the manual queue for a dispatcher.'
              : 'This job was cancelled and cannot continue through the delivery process.'}
          </span>
        </motion.div>
      )}
    </div>
  );
}
