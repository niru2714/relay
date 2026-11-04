import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Ban,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Hourglass,
  Inbox,
  PartyPopper,
  Siren,
  Truck,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { useDashboard } from '../api/hooks';
import type { Dashboard as DashboardData, JobStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { DemoControls } from '../components/DemoControls';
import { Route } from '../components/JobBits';
import {
  AnimatedNumber,
  EmptyState,
  ErrorState,
  PriorityBadge,
  Skeleton,
  StatusPill,
} from '../components/ui/primitives';
import { card, cardTitle, cx, tag } from '../components/ui/cls';
import { STATUS_LABEL, STATUS_UI } from '../lib/format';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 24 } },
};

interface Kpi {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  sub?: string;
  to: string;
  alert?: boolean;
}

function kpis(d: DashboardData): Kpi[] {
  const t = d.totals;
  return [
    {
      key: 'received',
      label: 'Total received',
      value: t.received,
      icon: Inbox,
      tone: 'bg-indigo-50 text-indigo-600',
      sub: 'all jobs in the system',
      to: '/jobs',
    },
    {
      key: 'await',
      label: 'Awaiting assignment',
      value: t.awaitingAssignment,
      icon: Briefcase,
      tone: 'bg-sky-50 text-sky-600',
      sub: 'ready for a rider',
      to: '/jobs?status=NEW,READY_FOR_ASSIGNMENT',
    },
    {
      key: 'confirm',
      label: 'Awaiting confirmation',
      value: t.awaitingConfirmation,
      icon: Hourglass,
      tone: 'bg-amber-50 text-amber-600',
      sub: 'assigned, rider yet to confirm',
      to: '/jobs?status=AWAITING_CONFIRMATION',
    },
    {
      key: 'progress',
      label: 'In progress',
      value: t.inProgress,
      icon: Truck,
      tone: 'bg-cyan-50 text-cyan-600',
      sub: `${d.inProgressBreakdown.accepted} accepted · ${d.inProgressBreakdown.pickedUp} in transit`,
      to: '/jobs?status=ACCEPTED,PICKED_UP',
    },
    {
      key: 'manual',
      label: 'Manual queue',
      value: t.manualQueue,
      icon: Siren,
      tone: 'bg-rose-50 text-rose-600',
      sub: t.manualQueue ? 'needs a dispatcher now' : 'queue is clear',
      to: '/queue',
      alert: t.manualQueue > 0,
    },
    {
      key: 'done',
      label: 'Completed',
      value: t.completed,
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-emerald-600',
      sub: 'delivered',
      to: '/jobs?status=DELIVERED',
    },
    {
      key: 'cancel',
      label: 'Cancelled',
      value: t.cancelled,
      icon: Ban,
      tone: 'bg-slate-100 text-slate-500',
      sub: 'before pickup',
      to: '/jobs?status=CANCELLED',
    },
  ];
}

const PIPELINE: JobStatus[] = [
  'NEW',
  'READY_FOR_ASSIGNMENT',
  'AWAITING_CONFIRMATION',
  'ACCEPTED',
  'PICKED_UP',
  'DELIVERED',
  'MANUAL_QUEUE',
  'CANCELLED',
];

export function Dashboard() {
  const { data, error, isLoading, refetch } = useDashboard();
  const navigate = useNavigate();

  if (error && !data)
    return (
      <div className={card}>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );

  return (
    <>
      <PageHeader
        title="Operations overview"
        subtitle="Everything that needs a decision, in one place."
      />

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <motion.div
            className="grid grid-cols-2 gap-4 lg:grid-cols-12"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {kpis(data).map((k, i) => (
              <motion.div
                key={k.key}
                variants={rise}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                className={i < 4 ? 'lg:col-span-3' : 'lg:col-span-4'}
              >
                <Link
                  to={k.to}
                  aria-label={`${k.label}: ${k.value}`}
                  className={cx(card, 'relative block transition-shadow hover:shadow-md')}
                >
                  {k.alert && (
                    <span
                      className="absolute right-3.5 top-3.5 size-2 rounded-full bg-rose-500"
                      aria-hidden
                    >
                      <span className="absolute -inset-1 animate-ping rounded-full border-2 border-rose-400" />
                    </span>
                  )}
                  <div className="flex items-center justify-between text-[12.5px] font-semibold text-slate-500">
                    <span>{k.label}</span>
                    <span className={cx('grid size-8 place-items-center rounded-lg', k.tone)}>
                      <k.icon size={16} />
                    </span>
                  </div>
                  <div className="mt-2.5 text-4xl font-bold leading-none tracking-tight text-slate-900">
                    <AnimatedNumber value={k.value} />
                  </div>
                  <div className="mt-2 min-h-[18px] text-xs text-slate-500">{k.sub}</div>
                </Link>
              </motion.div>
            ))}
          </motion.div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
            <div className="space-y-4">
              <section className={card}>
                <div className={cardTitle}>
                  Pipeline{' '}
                  <span className="ml-auto font-medium text-slate-500">
                    {data.totals.received} jobs
                  </span>
                </div>
                <div
                  className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-slate-100"
                  role="img"
                  aria-label="Jobs by status"
                >
                  {PIPELINE.map((s) => (
                    <motion.div
                      key={s}
                      title={`${STATUS_LABEL[s]}: ${data.byStatus[s]}`}
                      style={{ background: STATUS_UI[s].hex }}
                      initial={{ width: 0 }}
                      animate={{
                        width: `${(data.byStatus[s] / Math.max(1, data.totals.received)) * 100}%`,
                      }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
                  {PIPELINE.map((s) => (
                    <span key={s}>
                      <i
                        className="mr-1.5 inline-block size-2 rounded-[3px]"
                        style={{ background: STATUS_UI[s].hex }}
                      />
                      {STATUS_LABEL[s]} <b className="text-slate-900">{data.byStatus[s]}</b>
                    </span>
                  ))}
                </div>
              </section>

              <section className={card} aria-labelledby="attn">
                <div className={cardTitle} id="attn">
                  <Siren size={16} className="text-rose-500" /> Needs attention
                  <span className="ml-auto font-medium text-slate-500">
                    {data.attention.total}{' '}
                    {data.attention.critical > 0 && (
                      <b className="text-rose-600">· {data.attention.critical} critical</b>
                    )}
                  </span>
                </div>
                {data.attention.items.length === 0 ? (
                  <EmptyState icon={<PartyPopper size={28} />} title="All clear">
                    Nothing needs a dispatcher right now. Nice.
                  </EmptyState>
                ) : (
                  <motion.div
                    className="space-y-2"
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                  >
                    {data.attention.items.map((job) => {
                      const critical = job.attention.some((a) => a.severity === 'critical');
                      return (
                        <motion.div
                          key={job.id}
                          variants={rise}
                          layout
                          role="link"
                          tabIndex={0}
                          onClick={() => navigate(`/jobs/${job.id}`)}
                          onKeyDown={(e) => e.key === 'Enter' && navigate(`/jobs/${job.id}`)}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                        >
                          <div
                            className={cx(
                              'w-1 self-stretch rounded',
                              critical ? 'bg-rose-500' : 'bg-amber-400',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <b className="font-mono">{job.orderId}</b>
                              <StatusPill status={job.status} />
                              <PriorityBadge priority={job.priority} />
                            </div>
                            <div className="mt-1 truncate text-slate-700">
                              {job.attention[0]?.message}
                            </div>
                            <div className="text-xs text-slate-400">
                              <Route from={job.pickupZone} to={job.deliveryZone} /> · {job.load}{' '}
                              units
                            </div>
                          </div>
                          <ChevronRight size={18} className="text-slate-300" />
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </section>
            </div>

            <div className="space-y-4">
              <section className={card}>
                <div className={cardTitle}>
                  <UserCheck size={16} className="text-indigo-500" /> Rider capacity{' '}
                  <Link
                    to="/riders"
                    className="ml-auto font-medium text-indigo-600 hover:underline"
                  >
                    view riders →
                  </Link>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">
                    <AnimatedNumber value={data.riders.capacityUtilization} />%
                  </span>
                  <span className="text-slate-500">of total capacity committed</span>
                </div>
                <div className="my-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                    animate={{ width: `${data.riders.capacityUtilization}%` }}
                    transition={{ type: 'spring', stiffness: 90, damping: 18 }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={tag}>
                    <span className="size-1.5 rounded-full bg-emerald-500" />{' '}
                    {data.riders.available} available
                  </span>
                  <span className={tag}>
                    <span className="size-1.5 rounded-full bg-amber-500" /> {data.riders.onBreak} on
                    break
                  </span>
                  <span className={tag}>
                    <span className="size-1.5 rounded-full bg-slate-400" /> {data.riders.offline}{' '}
                    offline
                  </span>
                </div>
              </section>
              <DemoControls config={data.config} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
