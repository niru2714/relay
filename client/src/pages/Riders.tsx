import { useState } from 'react';
import { motion } from 'motion/react';
import { Bike, CheckCircle2, MapPin, Plus, Truck, UserPlus, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { useAction, useFit, useMeta, useRiders } from '../api/hooks';
import type { Availability, Rider, Vehicle } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState, ErrorState, Modal, Skeleton } from '../components/ui/primitives';
import { initials } from '../lib/format';
import { banner, card, cx, fieldError, input, label, tag } from '../components/ui/cls';

const VEHICLE_ICON: Record<Vehicle, typeof Bike> = { BIKE: Bike, SCOOTER: Bike, VAN: Truck };
const AVAIL_COLOR: Record<Availability, string> = {
  AVAILABLE: 'text-emerald-600',
  ON_BREAK: 'text-amber-600',
  OFFLINE: 'text-slate-400',
};

export function Riders() {
  const { data, error, isLoading, refetch } = useRiders();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Riders"
        subtitle="Availability, capacity and live workload. Reserved capacity is held for assignments awaiting confirmation."
      >
        <Button variant="primary" onClick={() => setAdding(true)}>
          <UserPlus size={15} /> Add rider
        </Button>
      </PageHeader>
      {error && !data ? (
        <div className={card}>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2 min-[1450px]:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data && data.length === 0 ? (
        <EmptyState
          title="No riders yet"
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add the first rider
            </Button>
          }
        >
          Add a rider so jobs can be dispatched.
        </EmptyState>
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2 min-[1450px]:grid-cols-3"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
        >
          {data!.map((r) => (
            <RiderCard key={r.id} rider={r} />
          ))}
        </motion.div>
      )}
      <AddRiderModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function RiderCard({ rider: r }: { rider: Rider }) {
  const { data: meta } = useMeta();
  const [checking, setChecking] = useState(false);
  const [fit, setFit] = useState({ pickupZone: 'T. Nagar', deliveryZone: 'Anna Nagar', load: 5 });
  const result = useFit(r.id, fit, checking && fit.load > 0);
  const patch = useAction(
    (body: Partial<Pick<Rider, 'availability'>>) => api.patch(`/riders/${r.id}`, body),
    { success: `${r.name} updated` },
  );
  const Vehicle = VEHICLE_ICON[r.vehicle];
  const pct = (n: number) => `${(n / r.capacity) * 100}%`;

  return (
    <motion.article
      className={cx(card, 'flex h-full flex-col')}
      variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
      whileHover={{ y: -3 }}
      layout
    >
      <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid size-10 flex-none place-items-center rounded-xl border border-indigo-100 bg-indigo-50 font-bold text-indigo-700">
          {initials(r.name)}
        </div>
        <div className="min-w-32 flex-1">
          <b>{r.name}</b>
          <div className="flex items-center gap-1.5 truncate text-[12.5px] text-slate-500">
            <Vehicle size={13} /> {r.vehicle.toLowerCase()} · <MapPin size={12} /> {r.currentZone}
          </div>
        </div>
        <select
          className={cx(
            input,
            'w-auto! flex-none py-1.5! text-[13px] font-semibold',
            AVAIL_COLOR[r.availability],
          )}
          value={r.availability}
          aria-label={`${r.name} availability`}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate({ availability: e.target.value as Availability })}
        >
          {meta?.availabilities.map((a) => (
            <option key={a} value={a}>
              {a.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-between text-xs text-slate-500">
        <span>Capacity</span>
        <span>
          <b className="text-slate-900">{r.availableCapacity}</b> of {r.capacity} free
        </span>
      </div>
      <div
        className="mt-1.5 flex h-2.5 overflow-hidden rounded-lg bg-slate-100"
        role="img"
        aria-label={`${r.activeLoad} active, ${r.reservedLoad} reserved, ${r.availableCapacity} free`}
      >
        <motion.div
          className="h-full bg-indigo-500"
          animate={{ width: pct(r.activeLoad) }}
          title="Active"
        />
        <motion.div
          className="h-full bg-amber-400"
          animate={{ width: pct(r.reservedLoad) }}
          title="Reserved (awaiting confirmation)"
        />
      </div>
      <div className="mt-1.5 flex gap-4 text-xs text-slate-500">
        <span>
          <i className="mr-1.5 inline-block size-2 rounded-[3px] bg-indigo-500" />
          active {r.activeLoad}
        </span>
        <span>
          <i className="mr-1.5 inline-block size-2 rounded-[3px] bg-amber-400" />
          reserved {r.reservedLoad}
        </span>
      </div>

      <div className="mt-3 flex justify-between text-xs text-slate-500">
        <span>Job slots</span>
        <span>
          {r.activeJobs + r.pendingJobs} / {r.maxConcurrentJobs} · {r.completedCount} delivered
        </span>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {Array.from({ length: r.maxConcurrentJobs }, (_, i) => (
          <i
            key={i}
            className={cx(
              'h-2 w-4 rounded',
              i < r.activeJobs
                ? 'bg-indigo-500'
                : i < r.activeJobs + r.pendingJobs
                  ? 'bg-amber-400'
                  : 'bg-slate-200',
            )}
          />
        ))}
      </div>

      <div className="my-3.5 flex flex-wrap gap-1.5">
        {r.zones.map((z) => (
          <span key={z} className={tag}>
            {z}
          </span>
        ))}
      </div>

      <div className="mt-auto">
        <div className="flex flex-wrap items-center gap-2">
          {r.canTakeAnotherDelivery ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 size={13} /> Can take another delivery
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
              <XCircle size={13} />{' '}
              {r.availability !== 'AVAILABLE' ? 'Not available' : 'At capacity'}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setChecking((c) => !c)}
            aria-expanded={checking}
          >
            Check a job
          </Button>
        </div>

        {checking && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 overflow-hidden"
          >
            <p className="mb-2 text-xs text-slate-500">
              What-if check: could {r.name.split(' ')[0]} take a job like this right now? (Nothing
              is assigned.)
            </p>
            <div className="grid grid-cols-[1fr_1fr_80px] gap-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className={label}>Pickup</span>
                <select
                  className={input}
                  value={fit.pickupZone}
                  onChange={(e) => setFit({ ...fit, pickupZone: e.target.value })}
                >
                  {meta?.zones.map((z) => (
                    <option key={z.name}>{z.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className={label}>Delivery</span>
                <select
                  className={input}
                  value={fit.deliveryZone}
                  onChange={(e) => setFit({ ...fit, deliveryZone: e.target.value })}
                >
                  {meta?.zones.map((z) => (
                    <option key={z.name}>{z.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className={label}>Load</span>
                <input
                  className={input}
                  inputMode="numeric"
                  value={fit.load}
                  onChange={(e) =>
                    setFit({ ...fit, load: Number(e.target.value.replace(/\D/g, '')) })
                  }
                />
              </label>
            </div>
            {result.data && (
              <div
                className={cx(result.data.canTake ? banner.info : banner.critical, 'mt-2.5')}
                role="status"
              >
                <span>
                  {result.data.canTake
                    ? `Yes - ${r.name.split(' ')[0]} can take this job.`
                    : result.data.reasons.map((x) => x.message).join(' · ')}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.article>
  );
}

function AddRiderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: meta } = useMeta();
  const [f, setF] = useState({
    name: '',
    vehicle: 'SCOOTER' as Vehicle,
    capacity: '20',
    maxConcurrentJobs: '3',
    zones: [] as string[],
    currentZone: '',
  });
  const [touched, setTouched] = useState(false);
  const create = useAction((body: unknown) => api.post('/riders', { body }), {
    success: 'Rider added',
    onSuccess: () => {
      onClose();
      setF({ ...f, name: '', zones: [], currentZone: '' });
      setTouched(false);
    },
  });
  const errors = {
    name: f.name.trim().length < 2 ? 'Enter the rider’s name' : '',
    zones: f.zones.length === 0 ? 'Pick at least one zone' : '',
    capacity: !(Number(f.capacity) >= 1) ? 'At least 1' : '',
    maxConcurrentJobs: !(Number(f.maxConcurrentJobs) >= 1) ? 'At least 1' : '',
  };
  const currentZone = f.zones.includes(f.currentZone) ? f.currentZone : (f.zones[0] ?? '');
  const invalid = Object.values(errors).some(Boolean);
  const toggle = (z: string) =>
    setF((s) => ({
      ...s,
      zones: s.zones.includes(z) ? s.zones.filter((x) => x !== z) : [...s.zones, z],
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a rider"
      subtitle="They start available and empty-handed at the current location you choose."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!invalid)
            create.mutate({
              name: f.name.trim(),
              vehicle: f.vehicle,
              zones: f.zones,
              currentZone: currentZone || undefined,
              capacity: Number(f.capacity),
              maxConcurrentJobs: Number(f.maxConcurrentJobs),
            });
        }}
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={label}>Name</span>
            <input
              className={input}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              aria-invalid={touched && !!errors.name}
            />
            {touched && errors.name && <span className={fieldError}>{errors.name}</span>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>Vehicle</span>
            <select
              className={input}
              value={f.vehicle}
              onChange={(e) => setF({ ...f, vehicle: e.target.value as Vehicle })}
            >
              {meta?.vehicles.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>Capacity (units)</span>
            <input
              className={input}
              inputMode="numeric"
              value={f.capacity}
              onChange={(e) => setF({ ...f, capacity: e.target.value })}
            />
            {touched && errors.capacity && <span className={fieldError}>{errors.capacity}</span>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>Max concurrent jobs</span>
            <input
              className={input}
              inputMode="numeric"
              value={f.maxConcurrentJobs}
              onChange={(e) => setF({ ...f, maxConcurrentJobs: e.target.value })}
            />
            {touched && errors.maxConcurrentJobs && (
              <span className={fieldError}>{errors.maxConcurrentJobs}</span>
            )}
          </label>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={label}>Service zones</span>
            <div className="flex flex-wrap gap-1.5">
              {meta?.zones.map((z) => (
                <button
                  type="button"
                  key={z.name}
                  className={cx(
                    tag,
                    'cursor-pointer',
                    f.zones.includes(z.name) && '!border-indigo-300 !bg-indigo-50 !text-indigo-700',
                  )}
                  aria-pressed={f.zones.includes(z.name)}
                  onClick={() => toggle(z.name)}
                >
                  {z.name}
                </button>
              ))}
            </div>
            {touched && errors.zones && <span className={fieldError}>{errors.zones}</span>}
          </div>
          {f.zones.length > 0 && (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={label}>Current location (where the rider is now)</span>
              <select
                className={input}
                value={currentZone}
                onChange={(e) => setF({ ...f, currentZone: e.target.value })}
              >
                {f.zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {create.error && (
          <div className={`${banner.critical} mt-3`} role="alert">
            {create.error.message}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={create.isPending}>
            Add rider
          </Button>
        </div>
      </form>
    </Modal>
  );
}
