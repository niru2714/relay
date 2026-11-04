import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api/client';
import { useAction, useMeta } from '../api/hooks';
import type { Job, Priority } from '../api/types';
import { Button, Modal } from './ui/primitives';
import { banner, fieldError, input, label } from './ui/cls';
import { useToast } from './ui/Toast';

const newOrderId = () => `ORD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const localInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const emptyForm = (): FormState => ({
  orderId: newOrderId(),
  pickupZone: '',
  deliveryZone: '',
  load: '5',
  priority: 'NORMAL',
  deadline: '',
  customerName: '',
  notes: '',
});

interface FormState {
  orderId: string;
  pickupZone: string;
  deliveryZone: string;
  load: string;
  priority: Priority;
  deadline: string;
  customerName: string;
  notes: string;
}

export function JobFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New delivery job"
      subtitle="Submitting the same order reference twice never creates a second job."
    >
      <JobForm onClose={onClose} />
    </Modal>
  );
}

function JobForm({ onClose }: { onClose: () => void }) {
  const { data: meta } = useMeta();
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<FormState>(emptyForm);
  const [touched, setTouched] = useState(false);

  const create = useAction(
    (body: Record<string, unknown>) =>
      api.post<{ data: Job; meta: { duplicate: boolean } }>('/jobs', { body }),
    {
      onSuccess: (res) => {
        if (res.meta.duplicate)
          toast.info(
            `${res.data.orderId} already exists - opened the existing job instead of creating a duplicate`,
          );
        else toast.success(`${res.data.orderId} created and ready for dispatch`);
        onClose();
        navigate(`/jobs/${res.data.id}`);
      },
    },
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const loadNum = Number(f.load);
  const errors: Partial<Record<keyof FormState, string>> = {
    ...(!/^[A-Za-z0-9._-]{3,40}$/.test(f.orderId)
      ? { orderId: '3–40 letters, numbers, . _ -' }
      : {}),
    ...(!f.pickupZone ? { pickupZone: 'Choose a pickup zone' } : {}),
    ...(!f.deliveryZone ? { deliveryZone: 'Choose a delivery zone' } : {}),
    ...(!Number.isInteger(loadNum) || loadNum < 1 || loadNum > 500
      ? { load: 'Whole number, 1–500' }
      : {}),
    ...(f.deadline && new Date(f.deadline) <= new Date()
      ? { deadline: 'Deadline must be in the future' }
      : {}),
  };
  const serverErrors = create.error?.fieldErrors ?? {};
  const err = (k: keyof FormState) => (touched ? errors[k] : undefined) ?? serverErrors[k];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    create.mutate({
      orderId: f.orderId.trim(),
      pickupZone: f.pickupZone,
      deliveryZone: f.deliveryZone,
      load: loadNum,
      priority: f.priority,
      deadline: toIso(f.deadline),
      customerName: f.customerName.trim() || undefined,
      notes: f.notes.trim() || undefined,
    });
  };
  const zones = meta?.zones ?? [];

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={label}>Order reference</span>
          <input
            className={`${input} font-mono`}
            value={f.orderId}
            onChange={(e) => set('orderId', e.target.value)}
            aria-invalid={!!err('orderId')}
          />
          {err('orderId') && <span className={fieldError}>{err('orderId')}</span>}
        </label>
        {(['pickupZone', 'deliveryZone'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1.5">
            <span className={label}>{k === 'pickupZone' ? 'Pickup zone' : 'Delivery zone'}</span>
            <select
              className={input}
              value={f[k]}
              onChange={(e) => set(k, e.target.value)}
              aria-invalid={!!err(k)}
            >
              <option value="">Select…</option>
              {zones.map((z) => (
                <option key={z.name}>{z.name}</option>
              ))}
            </select>
            {err(k) && <span className={fieldError}>{err(k)}</span>}
          </label>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className={label}>Load (capacity units)</span>
          <input
            className={input}
            inputMode="numeric"
            value={f.load}
            onChange={(e) => set('load', e.target.value)}
            aria-invalid={!!err('load')}
          />
          {err('load') && <span className={fieldError}>{err('load')}</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Priority</span>
          <select
            className={input}
            value={f.priority}
            onChange={(e) => set('priority', e.target.value as Priority)}
          >
            {(meta?.priorities ?? ['LOW', 'NORMAL', 'HIGH', 'URGENT']).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={label}>Delivery deadline (optional)</span>
          <div className="flex gap-2">
            <input
              className={input}
              type="datetime-local"
              value={f.deadline}
              onChange={(e) => set('deadline', e.target.value)}
              aria-invalid={!!err('deadline')}
            />
            {[1, 3].map((h) => (
              <Button
                key={h}
                type="button"
                size="sm"
                onClick={() => set('deadline', localInput(new Date(Date.now() + h * 3600_000)))}
              >
                +{h}h
              </Button>
            ))}
          </div>
          {err('deadline') && <span className={fieldError}>{err('deadline')}</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Customer (optional)</span>
          <input
            className={input}
            value={f.customerName}
            maxLength={80}
            onChange={(e) => set('customerName', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Notes (optional)</span>
          <input
            className={input}
            value={f.notes}
            maxLength={500}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
      {create.error && !Object.keys(serverErrors).length && (
        <div className={`${banner.critical} mt-3.5`} role="alert">
          {create.error.message}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2.5">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={create.isPending}>
          <Plus size={15} /> Create job
        </Button>
      </div>
    </form>
  );
}
