import { Job, Assignment } from '../models/index.js';
import {
  ASSIGNMENT_STATUS as A,
  EVENT_TYPE as E,
  JOB_STATUS as S,
  MANUAL_QUEUE_REASON as REASON,
} from '../domain/constants.js';
import { clock } from '../lib/clock.js';
import { systemActor } from '../lib/actors.js';
import { recordEvent } from './eventService.js';
import { expire } from './assignmentService.js';
import { transitionJob } from './jobTransitions.js';
import { dispatchPending } from './dispatchService.js';

export async function processExpired({ limit = 200 }: { limit?: number } = {}) {
  const now = clock.now();
  const due = await Assignment.find({ status: A.PENDING, expiresAt: { $lte: now } })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .select('_id');
  let expired = 0;
  for (const { _id } of due) {
    const result = await expire(_id);
    if (result) expired += 1;
  }
  return { due: due.length, expired };
}
const ORPHAN_GRACE_MS = 30_000;
export async function repairOrphans() {
  const cutoff = new Date(clock.now().getTime() - ORPHAN_GRACE_MS);
  const suspects = await Job.find({ status: S.AWAITING_CONFIRMATION, updatedAt: { $lte: cutoff } });
  let repaired = 0;
  for (const job of suspects) {
    const assignment = job.currentAssignmentId
      ? await Assignment.findById(job.currentAssignmentId).select('status')
      : null;
    if (assignment?.status === A.PENDING) continue;
    const moved = await transitionJob(job._id, {
      from: [S.AWAITING_CONFIRMATION],
      to: S.MANUAL_QUEUE,
      filter: { currentAssignmentId: job.currentAssignmentId ?? null },
      set: {
        manualQueue: {
          reason: REASON.ORPHANED_ASSIGNMENT,
          detail: 'Assignment record was missing or already closed',
          enteredAt: clock.now(),
        },
      },
      unset: ['currentAssignmentId', 'assignedRiderId', 'assignmentExpiresAt', 'assignedAt'],
    });
    if (moved) {
      repaired += 1;
      await recordEvent({
        jobId: job._id,
        type: E.MOVED_TO_MANUAL_QUEUE,
        actor: systemActor('RELAY integrity repair'),
        fromStatus: S.AWAITING_CONFIRMATION,
        toStatus: S.MANUAL_QUEUE,
        message: 'Moved to the manual queue: assignment record was missing or already closed',
        details: { reason: REASON.ORPHANED_ASSIGNMENT },
      });
    }
  }
  return { checked: suspects.length, repaired };
}
export async function runMaintenance() {
  const timeouts = await processExpired();
  const orphans = await repairOrphans();
  const dispatch = await dispatchPending();
  return { at: clock.now(), timeouts, orphans, dispatch };
}
export function startSweeper({
  intervalMs,
  log = console,
}: {
  intervalMs: number;
  log?: Pick<Console, 'info' | 'error'>;
}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await runMaintenance();
      if (result.timeouts.expired || result.orphans.repaired || result.dispatch.assigned) {
        log.info(
          `[sweeper] expired=${result.timeouts.expired} repaired=${result.orphans.repaired} autoAssigned=${result.dispatch.assigned}`,
        );
      }
    } catch (err) {
      log.error('[sweeper] failed', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
