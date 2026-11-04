import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Award, ChevronDown, Lightbulb, TriangleAlert, UserX } from 'lucide-react';
import { api } from '../api/client';
import { useAction, useRecommendations } from '../api/hooks';
import type { Candidate, JobDetail } from '../api/types';
import { Button, EmptyState, ErrorState, Skeleton } from './ui/primitives';
import { ReasonDialog } from './ui/ReasonDialog';
import { cx, tag } from './ui/cls';
import { initials } from '../lib/format';

const FACTORS: [keyof Candidate['breakdown'], string][] = [
  ['travel', 'Travel to pickup'],
  ['workload', 'Workload'],
  ['fit', 'Capacity fit'],
  ['deadline', 'Deadline'],
];

export function RecommendationPanel({
  job,
  mode,
}: {
  job: JobDetail;
  mode: 'assign' | 'reassign';
}) {
  const { data, error, isLoading, refetch } = useRecommendations(job.id, true);
  const [pending, setPending] = useState<Candidate | null>(null);
  const [showIneligible, setShowIneligible] = useState(false);

  const assign = useAction(
    (v: { riderId: string; overrideReason?: string }) =>
      api.post(`/jobs/${job.id}/assign`, { body: v }),
    {
      success: 'Rider assigned - waiting for their confirmation',
      onSuccess: () => setPending(null),
    },
  );
  const reassign = useAction(
    (v: { riderId: string; reason: string }) =>
      api.post(`/jobs/${job.id}/reassign`, {
        body: { ...v, expectedAssignmentId: job.currentAssignmentId },
      }),
    { success: 'Job reassigned', onSuccess: () => setPending(null) },
  );

  if (isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    );
  if (error || !data)
    return <ErrorState error={error ?? new Error('No data')} onRetry={() => void refetch()} />;

  const choose = (c: Candidate) => {
    if (mode === 'assign' && c.rank === 1) assign.mutate({ riderId: c.riderId });
    else setPending(c);
  };
  const candidates =
    mode === 'reassign'
      ? data.candidates.filter((c) => c.riderId !== job.assignedRiderId)
      : data.candidates;
  const top = data.candidates[0];

  return (
    <>
      {candidates.length === 0 ? (
        <EmptyState icon={<UserX size={28} />} title="No eligible rider right now">
          The job stays unassigned and is flagged for a dispatcher. You can wait for a rider to free
          up, change a rider's availability on the Riders page, or escalate the job to the manual
          queue.
        </EmptyState>
      ) : (
        <motion.div
          className="space-y-3"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07 } } }}
        >
          {candidates.map((c) => {
            const isTop = c.rank === 1 && mode === 'assign';
            return (
              <motion.article
                key={c.riderId}
                layout
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                className={cx(
                  'rounded-2xl border p-4',
                  isTop
                    ? 'border-indigo-300 bg-gradient-to-b from-indigo-50 to-white ring-1 ring-indigo-200'
                    : 'border-slate-200 bg-white',
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cx(
                      'grid size-7 place-items-center rounded-lg text-sm font-bold',
                      isTop
                        ? 'bg-gradient-to-br from-indigo-500 to-cyan-400 text-white'
                        : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {c.rank === 1 ? <Award size={16} /> : c.rank}
                  </div>
                  <div className="grid size-10 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 font-bold text-indigo-700">
                    {initials(c.riderName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <b>{c.riderName}</b>{' '}
                    {c.rank === 1 && (
                      <span
                        className={cx(tag, '!border-indigo-200 !bg-indigo-50 !text-indigo-600')}
                      >
                        Recommended
                      </span>
                    )}
                    <div className="text-xs text-slate-500">
                      {c.vehicle.toLowerCase()} · now in {c.currentZone} · ETA {c.etaMinutes} min
                    </div>
                  </div>
                  <div className="text-right">
                    <b className="text-[22px] tracking-tight">{c.score}</b>
                    <small className="text-slate-500"> / 100</small>
                  </div>
                </div>

                <div className="my-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  {FACTORS.map(([k, name]) => (
                    <div key={k} className="text-[11.5px] text-slate-500">
                      <div className="mb-1 flex justify-between">
                        <span>{name}</span>
                        <span className="font-medium text-slate-700">
                          {c.breakdown[k].points} pts
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${c.breakdown[k].value * 100}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
                  <Lightbulb size={13} className="mr-1 inline -translate-y-px text-amber-500" />
                  {c.explanation}
                </div>
                <ul className="mt-2 grid gap-1 text-[12.5px] text-slate-500">
                  {c.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
                {c.warnings.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-[12.5px] text-amber-700">
                    {c.warnings.map((w) => (
                      <li key={w}>
                        <TriangleAlert size={12} className="mr-1 inline -translate-y-px" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex justify-end">
                  <Button
                    variant={isTop ? 'primary' : 'default'}
                    busy={assign.isPending && assign.variables?.riderId === c.riderId}
                    onClick={() => choose(c)}
                  >
                    {mode === 'reassign'
                      ? 'Reassign to '
                      : c.rank === 1
                        ? 'Assign '
                        : 'Override: assign '}
                    {c.riderName.split(' ')[0]}
                  </Button>
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      )}

      {data.ineligible.length > 0 && (
        <div className="mt-3.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowIneligible((s) => !s)}
            aria-expanded={showIneligible}
          >
            <motion.span animate={{ rotate: showIneligible ? 180 : 0 }}>
              <ChevronDown size={14} />
            </motion.span>
            {data.ineligible.length} rider{data.ineligible.length > 1 ? 's' : ''} not eligible
          </Button>
          <AnimatePresence initial={false}>
            {showIneligible && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {data.ineligible.map((i) => (
                  <div
                    key={i.riderId}
                    className="flex justify-between gap-3 border-t border-dashed border-slate-200 py-2.5 text-[12.5px]"
                  >
                    <b>{i.riderName}</b>
                    <span className="text-right text-slate-500">
                      {i.reasons.map((r) => r.message).join(' · ')}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        onClose={() => setPending(null)}
        busy={assign.isPending || reassign.isPending}
        title={
          mode === 'reassign' ? `Reassign to ${pending?.riderName}` : 'Override the recommendation'
        }
        subtitle={
          mode === 'reassign'
            ? 'The current rider is released and their capacity freed.'
            : top
              ? `You are choosing ${pending?.riderName} (#${pending?.rank}) over ${top.riderName} (#1, ${top.score} pts). This is recorded in the audit trail.`
              : undefined
        }
        label={mode === 'reassign' ? 'Why reassign?' : 'Operational reason for the override'}
        placeholder={
          mode === 'reassign'
            ? 'e.g. First rider stuck in traffic'
            : 'e.g. Customer asked for this rider by name'
        }
        confirmLabel={mode === 'reassign' ? 'Reassign' : 'Assign with override'}
        onConfirm={(reason) =>
          pending &&
          (mode === 'reassign'
            ? reassign.mutate({ riderId: pending.riderId, reason })
            : assign.mutate({ riderId: pending.riderId, overrideReason: reason }))
        }
      />
    </>
  );
}
