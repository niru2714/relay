import {
  JOB_STATUS as S,
  MANUAL_QUEUE_REASON,
  TERMINAL_STATUSES,
  type JobStatus,
  type Priority,
} from './constants.js';
import type { AttentionItem, AttentionJob } from './types.js';

export const MANUAL_REASON_LABEL: Readonly<Record<string, string>> = Object.freeze({
  [MANUAL_QUEUE_REASON.ASSIGNMENT_TIMEOUT]: 'Rider did not confirm in time',
  [MANUAL_QUEUE_REASON.RIDER_REJECTED]: 'Rider rejected the assignment',
  [MANUAL_QUEUE_REASON.RIDER_WITHDREW]: 'Rider withdrew after accepting',
  [MANUAL_QUEUE_REASON.DISPATCHER_ESCALATION]: 'Escalated by a dispatcher',
  [MANUAL_QUEUE_REASON.ORPHANED_ASSIGNMENT]: 'Assignment record was inconsistent',
});
const minutes = (ms: number) => Math.round(ms / 60_000);
const UNASSIGNED_WARN_MIN: Record<Priority, number> = { URGENT: 5, HIGH: 10, NORMAL: 20, LOW: 45 };
const DEADLINE_WARN_MIN = 30;
const EXPIRY_WARN_FRACTION = 0.25;
export function computeAttention(
  job: AttentionJob,
  { now = new Date() }: { now?: Date } = {},
): AttentionItem[] {
  if (TERMINAL_STATUSES.includes(job.status)) return [];
  const items: AttentionItem[] = [];
  const t = now.getTime();
  if (job.status === S.MANUAL_QUEUE) {
    const label = MANUAL_REASON_LABEL[job.manualQueue?.reason ?? ''] ?? 'Needs manual dispatch';
    const waited = job.manualQueue?.enteredAt
      ? minutes(t - new Date(job.manualQueue.enteredAt).getTime())
      : 0;
    items.push({
      code: 'IN_MANUAL_QUEUE',
      severity: 'critical',
      message: `${label} · waiting ${waited} min`,
    });
  }
  if (job.status === S.READY_FOR_ASSIGNMENT) {
    if (job.flags?.noEligibleRiderSince) {
      items.push({
        code: 'NO_ELIGIBLE_RIDER',
        severity: 'critical',
        message: 'No eligible rider - assign manually, wait for capacity, or escalate',
      });
    } else {
      const waited = minutes(t - new Date(job.updatedAt ?? job.createdAt).getTime());
      if (waited >= (UNASSIGNED_WARN_MIN[job.priority] ?? 20)) {
        items.push({
          code: 'UNASSIGNED_TOO_LONG',
          severity: 'warning',
          message: `Unassigned for ${waited} min`,
        });
      }
    }
  }
  if (job.status === S.AWAITING_CONFIRMATION && job.assignmentExpiresAt && job.assignedAt) {
    const total = new Date(job.assignmentExpiresAt).getTime() - new Date(job.assignedAt).getTime();
    const left = new Date(job.assignmentExpiresAt).getTime() - t;
    if (left <= total * EXPIRY_WARN_FRACTION) {
      items.push({
        code: 'CONFIRMATION_EXPIRING',
        severity: 'warning',
        message:
          left > 0
            ? `Rider confirmation expires in ${minutes(left)} min`
            : 'Confirmation overdue - moving to queue',
      });
    }
  }
  if (job.deadline) {
    const left = new Date(job.deadline).getTime() - t;
    if (left < 0) {
      items.push({
        code: 'DEADLINE_MISSED',
        severity: 'critical',
        message: `Deadline passed ${minutes(-left)} min ago`,
      });
    } else if (
      minutes(left) <= DEADLINE_WARN_MIN &&
      (
        [S.READY_FOR_ASSIGNMENT, S.AWAITING_CONFIRMATION, S.MANUAL_QUEUE, S.NEW] as JobStatus[]
      ).includes(job.status)
    ) {
      items.push({
        code: 'DEADLINE_AT_RISK',
        severity: 'warning',
        message: `Deadline in ${minutes(left)} min and still unassigned`,
      });
    }
  }
  return items;
}
const SEVERITY_ORDER: Record<AttentionItem['severity'], number> = { critical: 0, warning: 1 };
export const worstSeverity = (items: AttentionItem[]) =>
  items.reduce(
    (worst: AttentionItem['severity'], i) =>
      SEVERITY_ORDER[i.severity] < SEVERITY_ORDER[worst] ? i.severity : worst,
    'warning',
  );
export const severityRank = (items: AttentionItem[]) =>
  items.length ? SEVERITY_ORDER[worstSeverity(items)] : 9;
