import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Ban,
  Check,
  CornerUpLeft,
  Flag,
  History,
  PackageCheck,
  PackageOpen,
  Repeat,
  Sparkles,
  Undo2,
  UserMinus,
  X,
} from 'lucide-react';
import { api, type RiderIdentity } from '../api/client';
import { useAction, useJob, useJobAssignments, useJobEvents } from '../api/hooks';
import type { Assignment, JobDetail } from '../api/types';
import { LifecycleStepper } from '../components/LifecycleStepper';
import { RecommendationPanel } from '../components/RecommendationPanel';
import { Timeline } from '../components/Timeline';
import { Route } from '../components/JobBits';
import {
  Button,
  CountdownRing,
  EmptyState,
  ErrorState,
  PriorityBadge,
  Skeleton,
  StatusPill,
} from '../components/ui/primitives';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { useToast } from '../components/ui/Toast';
import { useServerNow } from '../lib/clock';
import { banner, card, cardTitle, cx, tag } from '../components/ui/cls';
import {
  ASSIGNMENT_LABEL,
  MANUAL_REASON_LABEL,
  dateTime,
  initials,
  relativeTime,
} from '../lib/format';

type Dialog = 'cancel' | 'escalate' | 'requeue' | 'reject' | 'withdraw' | null;

export function JobDetailPage() {
  const { id = '' } = useParams();
  const job = useJob(id);
  const events = useJobEvents(id);
  const attempts = useJobAssignments(id);

  if (job.error && !job.data) {
    return (
      <>
        <BackLink />
        {job.error.message.includes('not found') ? (
          <EmptyState title="Job not found">
            This job does not exist (or the link is old).
          </EmptyState>
        ) : (
          <ErrorState error={job.error} onRetry={() => void job.refetch()} />
        )}
      </>
    );
  }
  if (!job.data)
    return (
      <>
        <BackLink />
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  return <Detail job={job.data} events={events} attempts={attempts} />;
}

const BackLink = () => (
  <Link
    to="/jobs"
    className="mb-3.5 inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900"
  >
    <ArrowLeft size={15} /> All jobs
  </Link>
);

function Detail({
  job,
  events,
  attempts,
}: {
  job: JobDetail;
  events: ReturnType<typeof useJobEvents>;
  attempts: ReturnType<typeof useJobAssignments>;
}) {
  const now = useServerNow();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reassigning, setReassigning] = useState(false);
  const close = () => setDialog(null);

  const rider: RiderIdentity | undefined = job.assignedRider ?? undefined;
  const assignmentId = job.currentAssignmentId;
  const post = (path: string, body?: unknown, as?: RiderIdentity) =>
    api.post(path, { body, asRider: as });

  const accept = useAction(() => post(`/assignments/${assignmentId}/accept`, undefined, rider), {
    success: `${rider?.name} confirmed the assignment`,
  });
  const reject = useAction(
    (reason: string) =>
      post(`/assignments/${assignmentId}/reject`, reason ? { reason } : {}, rider),
    { success: 'Rejected - job moved to the manual queue', onSuccess: close },
  );
  const withdraw = useAction(
    (reason: string) =>
      post(`/assignments/${assignmentId}/withdraw`, reason ? { reason } : {}, rider),
    { success: 'Rider withdrew - job moved to the manual queue', onSuccess: close },
  );
  const pickup = useAction(() => post(`/jobs/${job.id}/pickup`, undefined, rider), {
    success: 'Marked as picked up',
  });
  const deliver = useAction(() => post(`/jobs/${job.id}/deliver`, undefined, rider), {
    success: 'Delivered 🎉',
  });
  const cancel = useAction((reason: string) => post(`/jobs/${job.id}/cancel`, { reason }), {
    success: 'Job cancelled',
    onSuccess: close,
  });
  const escalate = useAction((reason: string) => post(`/jobs/${job.id}/escalate`, { reason }), {
    success: 'Escalated to the manual queue',
    onSuccess: close,
  });
  const requeue = useAction(
    (note: string) => post(`/jobs/${job.id}/requeue`, note ? { note } : {}),
    { success: 'Returned to the dispatch pool', onSuccess: close },
  );
  const auto = useAction(
    () =>
      api.post<{ meta: { assigned: boolean; reason: string | null } }>(
        `/jobs/${job.id}/auto-assign`,
      ),
    {
      onSuccess: (r) =>
        r.meta.assigned
          ? toast.success('Top-ranked rider assigned')
          : toast.info(
              r.meta.reason === 'NO_ELIGIBLE_RIDER'
                ? 'No eligible rider - the job is flagged for attention'
                : `Not assigned (${r.meta.reason})`,
            ),
    },
  );

  const s = job.status;
  const unassigned = s === 'READY_FOR_ASSIGNMENT' || s === 'MANUAL_QUEUE';
  const cancellable = [
    'NEW',
    'READY_FOR_ASSIGNMENT',
    'AWAITING_CONFIRMATION',
    'ACCEPTED',
    'MANUAL_QUEUE',
  ].includes(s);
  const current = job.currentAssignment;

  return (
    <>
      <BackLink />
      <motion.section className={card} layout>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold tracking-tight">{job.orderId}</h1>
          <StatusPill status={s} />
          <PriorityBadge priority={job.priority} />
          {job.attemptCount > 0 && (
            <span className={tag}>
              <History size={12} /> {job.attemptCount} attempt{job.attemptCount > 1 ? 's' : ''}
            </span>
          )}
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2">
            {unassigned && (
              <Button
                variant="primary"
                busy={auto.isPending}
                onClick={() => auto.mutate(undefined)}
              >
                <Sparkles size={14} /> Auto-assign top pick
              </Button>
            )}
            {s === 'READY_FOR_ASSIGNMENT' && (
              <Button onClick={() => setDialog('escalate')}>
                <Flag size={14} /> Escalate
              </Button>
            )}
            {s === 'MANUAL_QUEUE' && (
              <Button onClick={() => setDialog('requeue')}>
                <Undo2 size={14} /> Return to pool
              </Button>
            )}
            {cancellable && (
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                <Ban size={14} /> Cancel job
              </Button>
            )}
          </div>
        </div>
        <div className="mb-1.5 mt-4">
          <LifecycleStepper status={s} />
        </div>
        <AnimatePresence initial={false}>
          {job.attention.map((a) => (
            <motion.div
              key={a.code}
              className={cx(
                a.severity === 'critical' ? banner.critical : banner.warning,
                'mt-2.5 overflow-hidden',
              )}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <span>{a.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.section>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <section className={card}>
            <div className={cardTitle}>Job details</div>
            <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2.5 [&_dt]:text-slate-500 [&_dd]:m-0">
              <dt>Route</dt>
              <dd>
                <Route from={job.pickupZone} to={job.deliveryZone} />
              </dd>
              <dt>Load</dt>
              <dd>{job.load} capacity units</dd>
              <dt>Deadline</dt>
              <dd>
                {job.deadline ? (
                  <>
                    {dateTime(job.deadline)}{' '}
                    <span className="text-slate-500">({relativeTime(job.deadline, now)})</span>
                  </>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </dd>
              <dt>Created</dt>
              <dd>
                {dateTime(job.createdAt)}{' '}
                <span className="text-slate-500">by {job.createdBy ?? 'system'}</span>
              </dd>
              {job.customerName && (
                <>
                  <dt>Customer</dt>
                  <dd>{job.customerName}</dd>
                </>
              )}
              {job.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{job.notes}</dd>
                </>
              )}
              {s === 'MANUAL_QUEUE' && job.manualQueue && (
                <>
                  <dt>Why in queue</dt>
                  <dd>
                    <b className="text-rose-600">
                      {MANUAL_REASON_LABEL[job.manualQueue.reason ?? ''] ?? job.manualQueue.reason}
                    </b>
                    {job.manualQueue.detail && (
                      <div className="text-slate-500">{job.manualQueue.detail}</div>
                    )}
                  </dd>
                </>
              )}
              {s === 'CANCELLED' && job.cancellation && (
                <>
                  <dt>Cancelled</dt>
                  <dd>
                    “{job.cancellation.reason}”{' '}
                    <span className="text-slate-500">by {job.cancellation.by}</span>
                  </dd>
                </>
              )}
            </dl>
          </section>

          {current && job.assignedRider && (
            <section className={card} aria-labelledby="assign-title">
              <div className={cardTitle} id="assign-title">
                Current assignment
              </div>
              <div className="flex items-center gap-4">
                <div className="grid size-10 flex-none place-items-center rounded-xl border border-indigo-100 bg-indigo-50 font-bold text-indigo-700">
                  {initials(job.assignedRider.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <b>{job.assignedRider.name}</b>
                  <div className="text-[12.5px] text-slate-500">
                    Attempt #{current.attemptNo} · {current.load} units reserved ·{' '}
                    {current.source === 'OVERRIDE'
                      ? 'manual override'
                      : current.source === 'AUTO'
                        ? 'auto-dispatched'
                        : current.source === 'REASSIGNMENT'
                          ? 'reassigned'
                          : 'recommended pick'}
                  </div>
                  {current.overrideReason && (
                    <div className="text-[12.5px] text-slate-500">
                      Override: “{current.overrideReason}”
                    </div>
                  )}
                </div>
                {s === 'AWAITING_CONFIRMATION' && (
                  <CountdownRing
                    assignedAt={current.assignedAt}
                    expiresAt={current.expiresAt}
                    now={now}
                  />
                )}
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                {s === 'AWAITING_CONFIRMATION' && (
                  <>
                    <Button
                      variant="good"
                      busy={accept.isPending}
                      onClick={() => accept.mutate(undefined)}
                    >
                      <Check size={14} /> Simulate: rider confirms
                    </Button>
                    <Button variant="danger" onClick={() => setDialog('reject')}>
                      <X size={14} /> Simulate: rider rejects
                    </Button>
                  </>
                )}
                {s === 'ACCEPTED' && (
                  <>
                    <Button
                      variant="primary"
                      busy={pickup.isPending}
                      onClick={() => pickup.mutate(undefined)}
                    >
                      <PackageOpen size={14} /> Mark picked up
                    </Button>
                    <Button onClick={() => setDialog('withdraw')}>
                      <UserMinus size={14} /> Rider withdraws
                    </Button>
                  </>
                )}
                {s === 'PICKED_UP' && (
                  <Button
                    variant="good"
                    busy={deliver.isPending}
                    onClick={() => deliver.mutate(undefined)}
                  >
                    <PackageCheck size={14} /> Mark delivered
                  </Button>
                )}
                {(s === 'AWAITING_CONFIRMATION' || s === 'ACCEPTED') && (
                  <Button onClick={() => setReassigning((r) => !r)} aria-expanded={reassigning}>
                    <Repeat size={14} /> {reassigning ? 'Hide reassign' : 'Reassign'}
                  </Button>
                )}
              </div>
            </section>
          )}

          {(unassigned || reassigning) && (
            <section className={card} aria-labelledby="rec-title">
              <div className={cardTitle} id="rec-title">
                <Sparkles size={16} className="text-indigo-500" />{' '}
                {reassigning ? 'Choose a replacement rider' : 'Recommended riders'}
              </div>
              <RecommendationPanel
                job={job}
                mode={reassigning ? 'reassign' : 'assign'}
                key={reassigning ? 'r' : 'a'}
              />
            </section>
          )}

          <AttemptsCard attempts={attempts.data} />
        </div>

        <section className={cx(card, 'xl:sticky xl:top-5')} aria-labelledby="tl-title">
          <div className={cardTitle} id="tl-title">
            <History size={16} /> Activity history{' '}
            <span className="ml-auto font-medium text-slate-500">
              {events.data?.length ?? 0} events
            </span>
          </div>
          {events.error && !events.data ? (
            <ErrorState error={events.error} onRetry={() => void events.refetch()} />
          ) : events.data ? (
            <Timeline events={events.data} />
          ) : (
            <Skeleton className="h-52" />
          )}
        </section>
      </div>

      <ReasonDialog
        open={dialog === 'cancel'}
        onClose={close}
        busy={cancel.isPending}
        danger
        title="Cancel this job?"
        subtitle="Any rider assignment is closed and their reserved capacity is released."
        placeholder="e.g. Customer cancelled the order"
        confirmLabel="Cancel job"
        onConfirm={(r) => cancel.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'escalate'}
        onClose={close}
        busy={escalate.isPending}
        title="Escalate to the manual queue"
        subtitle="Use when no rider can take this and a human needs to step in."
        placeholder="e.g. Customer wants a call before dispatch"
        confirmLabel="Escalate"
        onConfirm={(r) => escalate.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'requeue'}
        onClose={close}
        busy={requeue.isPending}
        optional
        label="Note"
        title="Return to the dispatch pool"
        subtitle="The job becomes ready for assignment again."
        confirmLabel="Return to pool"
        onConfirm={(r) => requeue.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={close}
        busy={reject.isPending}
        optional
        danger
        label="Rider's reason"
        title={`${rider?.name ?? 'Rider'} rejects the assignment`}
        subtitle="The attempt is kept on record, capacity is released and the job goes to the manual queue."
        confirmLabel="Reject assignment"
        onConfirm={(r) => reject.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'withdraw'}
        onClose={close}
        busy={withdraw.isPending}
        optional
        danger
        label="Rider's reason"
        title={`${rider?.name ?? 'Rider'} withdraws`}
        subtitle="Allowed only before pickup. The job returns to the manual queue."
        confirmLabel="Withdraw"
        onConfirm={(r) => withdraw.mutate(r)}
      />
    </>
  );
}

function AttemptsCard({ attempts }: { attempts?: Assignment[] }) {
  if (!attempts?.length) return null;
  const TONE: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
    ACCEPTED: 'bg-violet-50 text-violet-700 ring-violet-200',
    COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
    EXPIRED: 'bg-rose-50 text-rose-700 ring-rose-200',
    WITHDRAWN: 'bg-rose-50 text-rose-700 ring-rose-200',
    REASSIGNED: 'bg-slate-100 text-slate-600 ring-slate-200',
    CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <section className={card}>
      <div className={cardTitle}>
        <CornerUpLeft size={16} /> Assignment attempts{' '}
        <span className="ml-auto font-medium text-slate-500">kept even when they fail</span>
      </div>
      {attempts.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 border-t border-dashed border-slate-200 py-2.5 text-[12.5px] first:border-t-0"
        >
          <div>
            <b>
              #{a.attemptNo} · {a.riderName}
            </b>
            <div className="text-xs text-slate-500">
              {dateTime(a.assignedAt)} · {a.load} units{a.closeReason ? ` · ${a.closeReason}` : ''}
            </div>
          </div>
          <span
            className={cx(
              'rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
              TONE[a.status],
            )}
          >
            {ASSIGNMENT_LABEL[a.status]}
          </span>
        </div>
      ))}
    </section>
  );
}
