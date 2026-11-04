import { JOB_STATUS as S, type JobStatus } from './constants.js';
import { conflict } from '../lib/errors.js';

export const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = Object.freeze({
  [S.NEW]: [S.READY_FOR_ASSIGNMENT, S.CANCELLED],
  [S.READY_FOR_ASSIGNMENT]: [S.AWAITING_CONFIRMATION, S.MANUAL_QUEUE, S.CANCELLED],
  [S.AWAITING_CONFIRMATION]: [S.ACCEPTED, S.AWAITING_CONFIRMATION, S.MANUAL_QUEUE, S.CANCELLED],
  [S.ACCEPTED]: [S.PICKED_UP, S.AWAITING_CONFIRMATION, S.MANUAL_QUEUE, S.CANCELLED],
  [S.PICKED_UP]: [S.DELIVERED],
  [S.MANUAL_QUEUE]: [S.AWAITING_CONFIRMATION, S.READY_FOR_ASSIGNMENT, S.CANCELLED],
  [S.DELIVERED]: [],
  [S.CANCELLED]: [],
});
export const allowedFrom = (status: JobStatus): readonly JobStatus[] => TRANSITIONS[status] ?? [];
export const canTransition = (from: JobStatus, to: JobStatus) => allowedFrom(from).includes(to);
export const sourcesFor = (to: JobStatus) =>
  (Object.keys(TRANSITIONS) as JobStatus[]).filter((from) => canTransition(from, to));
export function invalidTransition(from: JobStatus, to: JobStatus, hint?: string) {
  return conflict(
    'INVALID_TRANSITION',
    `Cannot move a job from ${from} to ${to}${hint ? `. ${hint}` : ''}`,
    { from, to, allowed: allowedFrom(from) },
  );
}
export function assertTransition(from: JobStatus, to: JobStatus, hint?: string): void {
  if (!canTransition(from, to)) throw invalidTransition(from, to, hint);
}
