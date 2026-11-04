import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, PartyPopper, RotateCw, Search, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { useAction, useManualQueue } from '../api/hooks';
import { PageHeader } from '../components/Layout';
import { Route } from '../components/JobBits';
import {
  Button,
  EmptyState,
  ErrorState,
  PriorityBadge,
  Skeleton,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/Toast';
import { card, tag } from '../components/ui/cls';
import { MANUAL_REASON_LABEL, relativeTime } from '../lib/format';
import { useServerNow } from '../lib/clock';

export function ManualQueue() {
  const { data, error, isLoading, refetch } = useManualQueue();
  const now = useServerNow();
  const navigate = useNavigate();
  const toast = useToast();
  const auto = useAction(
    (id: string) =>
      api.post<{ meta: { assigned: boolean; reason: string | null } }>(`/jobs/${id}/auto-assign`),
    {
      onSuccess: (r) =>
        r.meta.assigned
          ? toast.success('Top-ranked rider assigned - awaiting their confirmation')
          : toast.info('No eligible rider right now. Open the job to review options.'),
    },
  );

  return (
    <>
      <PageHeader
        title="Manual queue"
        subtitle="Jobs that fell out of automatic dispatch - most urgent and longest-waiting first."
      >
        <Button onClick={() => void refetch()}>
          <RotateCw size={14} /> Refresh
        </Button>
      </PageHeader>

      {error && !data ? (
        <div className={card}>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : data && data.length === 0 ? (
        <section className={card}>
          <EmptyState icon={<PartyPopper size={28} />} title="The queue is clear">
            Every job is either dispatched or waiting on a rider’s confirmation. Timed-out and
            rejected assignments land here automatically.
            <div className="mt-3">
              <Link to="/jobs" className="font-medium text-indigo-600 hover:underline">
                Browse all jobs →
              </Link>
            </div>
          </EmptyState>
        </section>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {data!.map((j) => (
              <motion.article
                key={j.id}
                layout
                className={`${card} border-rose-200`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 60 }}
                whileHover={{ x: 3 }}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-64 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <b className="font-mono text-base">{j.orderId}</b>
                      <PriorityBadge priority={j.priority} />
                      {j.failedAttempts > 0 && (
                        <span className={tag}>
                          {j.failedAttempts} failed attempt{j.failedAttempts > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 font-semibold text-rose-600">
                      {MANUAL_REASON_LABEL[j.manualQueue?.reason ?? ''] ?? 'Needs manual dispatch'}
                    </div>
                    <div className="text-[12.5px] text-slate-500">
                      {j.manualQueue?.detail && <>{j.manualQueue.detail} · </>}waiting{' '}
                      {j.manualQueue?.enteredAt
                        ? relativeTime(j.manualQueue.enteredAt, now).replace(' ago', '')
                        : '—'}
                    </div>
                    <div className="mt-1 text-[12.5px] text-slate-400">
                      <Route from={j.pickupZone} to={j.deliveryZone} /> · {j.load} units
                      {j.deadline && <> · due {relativeTime(j.deadline, now)}</>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      busy={auto.isPending && auto.variables === j.id}
                      onClick={() => auto.mutate(j.id)}
                    >
                      <Sparkles size={14} /> Assign top pick
                    </Button>
                    <Button onClick={() => navigate(`/jobs/${j.id}`)}>
                      <Search size={14} /> Investigate <ArrowRight size={14} />
                    </Button>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
