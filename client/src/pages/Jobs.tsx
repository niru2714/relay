import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Plus, Search, SearchX, Siren } from 'lucide-react';
import { useJobs, useMeta } from '../api/hooks';
import { PageHeader } from '../components/Layout';
import { JobFormModal } from '../components/JobFormModal';
import { AttentionBadges, Route } from '../components/JobBits';
import {
  Button,
  EmptyState,
  ErrorState,
  PriorityBadge,
  Skeleton,
  StatusPill,
} from '../components/ui/primitives';
import { card, cx, input } from '../components/ui/cls';
import { dateTime, relativeTime, STATUS_LABEL } from '../lib/format';
import { useServerNow } from '../lib/clock';
import type { JobStatus } from '../api/types';

const QUICK: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'To assign', value: 'NEW,READY_FOR_ASSIGNMENT' },
  { label: 'Awaiting', value: 'AWAITING_CONFIRMATION' },
  { label: 'In progress', value: 'ACCEPTED,PICKED_UP' },
  { label: 'Manual queue', value: 'MANUAL_QUEUE' },
  { label: 'Done', value: 'DELIVERED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

export function Jobs() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const now = useServerNow();
  const [creating, setCreating] = useState(false);

  const status = sp.get('status') ?? '';
  const zone = sp.get('zone') ?? '';
  const priority = sp.get('priority') ?? '';
  const attention = sp.get('attention') === 'true';
  const page = Number(sp.get('page') ?? 1);
  const urlQ = sp.get('q') ?? '';
  const [q, setQ] = useState(urlQ);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== urlQ && update({ q: q || undefined }), 300);
    return () => clearTimeout(t);
  });

  const { data, error, isLoading, isFetching, refetch } = useJobs({
    q: urlQ || undefined,
    status: status || undefined,
    zone: zone || undefined,
    priority: priority || undefined,
    attention: attention || undefined,
    page,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.limit)) : 1;
  const filtered = !!(urlQ || status || zone || priority || attention);
  const th =
    'px-3 pb-1 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-400';
  const td =
    'border-y border-slate-100 bg-white px-3 py-3 align-middle first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r group-hover:bg-indigo-50/40';

  return (
    <>
      <PageHeader
        title="Delivery jobs"
        subtitle="Search by order ID, filter by status or zone, open a job for its full history."
      >
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New job
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 max-w-sm flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={cx(input, '!pl-9')}
            placeholder="Search order ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by order ID"
          />
        </div>
        <select
          className={cx(input, '!w-auto')}
          value={zone}
          onChange={(e) => update({ zone: e.target.value })}
          aria-label="Filter by zone"
        >
          <option value="">All zones</option>
          {meta?.zones.map((z) => (
            <option key={z.name}>{z.name}</option>
          ))}
        </select>
        <select
          className={cx(input, '!w-auto')}
          value={priority}
          onChange={(e) => update({ priority: e.target.value })}
          aria-label="Filter by priority"
        >
          <option value="">Any priority</option>
          {meta?.priorities.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <Button
          variant={attention ? 'danger' : 'default'}
          onClick={() => update({ attention: attention ? undefined : 'true' })}
          aria-pressed={attention}
        >
          <Siren size={14} /> Needs attention
        </Button>
      </div>

      <div
        className="mb-4 inline-flex flex-wrap gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        role="tablist"
        aria-label="Quick status filter"
      >
        {QUICK.map((o) => (
          <button
            key={o.label}
            role="tab"
            aria-selected={status === o.value}
            onClick={() => update({ status: o.value || undefined })}
            className={cx(
              'relative rounded-lg px-3 py-1.5 text-[12.5px] font-semibold',
              status === o.value ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {status === o.value && (
              <motion.span
                layoutId="seg-bg"
                className="absolute inset-0 rounded-lg bg-indigo-50 ring-1 ring-indigo-200"
                transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        ))}
        {status && !QUICK.some((o) => o.value === status) && (
          <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
            {status
              .split(',')
              .map((s) => STATUS_LABEL[s as JobStatus] ?? s)
              .join(' + ')}
          </span>
        )}
      </div>

      <section
        className={cx(card, '!p-3.5 transition-opacity', isFetching && !isLoading && 'opacity-85')}
      >
        {error && !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={filtered ? <SearchX size={28} /> : undefined}
            title={filtered ? 'No jobs match these filters' : 'No jobs yet'}
            action={
              filtered ? (
                <Button
                  onClick={() => {
                    setQ('');
                    setSp({}, { replace: true });
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={15} /> Create the first job
                </Button>
              )
            }
          >
            {filtered
              ? 'Try a different search or clear the filters.'
              : 'Create a delivery job to get the dispatch desk moving.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-y-1.5">
              <thead>
                <tr>
                  {[
                    'Order',
                    'Status',
                    'Route',
                    'Load',
                    'Priority',
                    'Rider',
                    'Deadline',
                    'Attention',
                  ].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {data!.data.map((j) => (
                    <motion.tr
                      key={j.id}
                      layout
                      className="group cursor-pointer"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => navigate(`/jobs/${j.id}`)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/jobs/${j.id}`)}
                    >
                      <td className={td}>
                        <b className="whitespace-nowrap font-mono">{j.orderId}</b>
                        <div className="text-[11.5px] text-slate-400">
                          {relativeTime(j.createdAt, now)}
                        </div>
                      </td>
                      <td className={td}>
                        <StatusPill status={j.status} />
                      </td>
                      <td className={td}>
                        <Route from={j.pickupZone} to={j.deliveryZone} />
                      </td>
                      <td className={td}>{j.load}</td>
                      <td className={td}>
                        <PriorityBadge priority={j.priority} />
                      </td>
                      <td className={td}>
                        {j.assignedRider?.name ?? (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className={td}>
                        {j.deadline ? (
                          <span
                            className={cx(
                              new Date(j.deadline) < now &&
                                !['DELIVERED', 'CANCELLED'].includes(j.status) &&
                                'font-semibold text-rose-600',
                            )}
                          >
                            {dateTime(j.deadline)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className={td}>
                        <AttentionBadges items={j.attention} />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
        {data && data.meta.total > 0 && (
          <div className="mt-3 flex items-center justify-between text-slate-500">
            <span>
              {data.meta.total} job{data.meta.total === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                disabled={page >= totalPages}
                onClick={() => update({ page: String(page + 1) })}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </section>
      <JobFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
