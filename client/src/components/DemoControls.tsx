import { useState } from 'react';
import { FastForward, FlaskConical, RotateCcw, ShieldCheck, Timer, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useAction, useIntegrity } from '../api/hooks';
import type { SystemConfig } from '../api/types';
import { Button } from './ui/primitives';
import { useToast } from './ui/Toast';
import { card, cardTitle, fieldError, input, label } from './ui/cls';

const formatSkip = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;

interface SweepResult {
  timeouts: { expired: number };
  orphans: { repaired: number };
  dispatch: { assigned: number; flagged: number };
}

export function DemoControls({ config }: { config: SystemConfig }) {
  const toast = useToast();
  const [minutes, setMinutes] = useState(String(config.assignmentTimeoutMinutes));
  const integrity = useIntegrity();
  const save = useAction(
    (patch: Partial<Pick<SystemConfig, 'assignmentTimeoutMinutes' | 'autoDispatch'>>) =>
      api.put('/system/config', patch),
    { success: 'Settings saved' },
  );
  const advance = useAction(
    (m: number) => api.post('/system/clock/advance', { body: { minutes: m } }),
    { success: 'Simulated clock moved forward' },
  );
  const reset = useAction(() => api.post('/system/clock/reset'), {
    success: 'Clock back to real time',
  });
  const sweep = useAction(() => api.post<{ data: SweepResult }>('/system/sweep'), {
    onSuccess: (r) => {
      const { timeouts, orphans, dispatch } = r.data;
      toast.info(
        `Sweep complete - ${timeouts.expired} timed out, ${orphans.repaired} repaired, ${dispatch.assigned} auto-assigned`,
      );
    },
  });
  const demo = useAction(() => api.post('/system/reset-demo'), { success: 'Demo data reloaded' });
  const clear = useAction(() => api.post('/system/clear'), {
    success: 'All data cleared - start fresh',
  });
  const parsed = Number(minutes);
  const valid = Number.isFinite(parsed) && parsed >= 0.05 && parsed <= 1440;

  const windowMin = config.assignmentTimeoutMinutes;
  const skips = [Math.max(1, Math.round(windowMin / 2)), Math.ceil(windowMin) + 1].filter(
    (m, i, a) => a.indexOf(m) === i,
  );
  return (
    <section className={card} aria-labelledby="demo-title">
      <div className={cardTitle} id="demo-title">
        <FlaskConical size={16} className="text-indigo-500" /> Demo controls
      </div>
      <p className="-mt-1.5 mb-3 text-[12.5px] text-slate-500">
        Test the timeout without waiting two hours: shorten the window and/or move the clock, then
        sweep.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className={label}>Confirmation window (minutes) - default 120</span>
        <div className="flex gap-2">
          <input
            className={input}
            inputMode="decimal"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-invalid={!valid}
          />
          <Button
            disabled={!valid || parsed === config.assignmentTimeoutMinutes}
            busy={save.isPending}
            onClick={() => save.mutate({ assignmentTimeoutMinutes: parsed })}
          >
            <Timer size={14} /> Apply
          </Button>
        </div>
        {!valid && <span className={fieldError}>Enter between 0.05 and 1440 minutes.</span>}
      </label>
      <div className="mt-3.5 text-slate-500">
        Simulated clock{' '}
        {config.simulatedClock ? (
          <b className="text-amber-600">(+{config.clockOffsetMinutes} min)</b>
        ) : (
          '(real time)'
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {skips.map((m) => (
          <Button key={m} size="sm" busy={advance.isPending} onClick={() => advance.mutate(m)}>
            <FastForward size={13} /> +{formatSkip(m)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={!config.simulatedClock}
          onClick={() => reset.mutate(undefined)}
        >
          <RotateCcw size={13} /> Reset
        </Button>
      </div>
      <div className="mt-3.5">
        <Button variant="primary" busy={sweep.isPending} onClick={() => sweep.mutate(undefined)}>
          <Zap size={14} /> Run timeout sweep now
        </Button>
      </div>
      <label className="mt-3.5 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="size-4 accent-indigo-600"
          checked={config.autoDispatch}
          onChange={(e) => save.mutate({ autoDispatch: e.target.checked })}
        />
        <span>
          Auto-dispatch top-ranked rider <span className="text-slate-500">(autonomous mode)</span>
        </span>
      </label>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-3.5">
        <ShieldCheck
          size={15}
          className={integrity.data?.ok === false ? 'text-rose-500' : 'text-emerald-500'}
        />
        <span className="text-[12.5px] text-slate-500">
          Ledger integrity:{' '}
          {integrity.data ? (integrity.data.ok ? 'consistent' : 'DRIFT DETECTED') : 'checking…'}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            busy={clear.isPending}
            onClick={() => window.confirm('Delete all jobs and riders?') && clear.mutate(undefined)}
          >
            Clear all data
          </Button>
          <Button
            size="sm"
            variant="ghost"
            busy={demo.isPending}
            onClick={() => demo.mutate(undefined)}
          >
            Load demo data
          </Button>
        </div>
      </div>
    </section>
  );
}
