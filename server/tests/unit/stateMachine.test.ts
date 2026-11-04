import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, JOB_STATUS as S } from '../../src/domain/constants.js';
import { TRANSITIONS, assertTransition, canTransition } from '../../src/domain/jobStateMachine.js';

describe('job state machine', () => {
  it('defines a rule for every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...JOB_STATUSES].sort());
  });

  it('allows the happy path end to end', () => {
    const path = [
      S.NEW,
      S.READY_FOR_ASSIGNMENT,
      S.AWAITING_CONFIRMATION,
      S.ACCEPTED,
      S.PICKED_UP,
      S.DELIVERED,
    ];
    for (let i = 0; i < path.length - 1; i += 1)
      expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('cannot deliver before pickup, or pick up before acceptance', () => {
    expect(canTransition(S.ACCEPTED, S.DELIVERED)).toBe(false);
    expect(canTransition(S.AWAITING_CONFIRMATION, S.PICKED_UP)).toBe(false);
    expect(canTransition(S.READY_FOR_ASSIGNMENT, S.ACCEPTED)).toBe(false);
  });

  it('terminal states have no exits', () => {
    for (const terminal of [S.DELIVERED, S.CANCELLED]) {
      for (const to of JOB_STATUSES) expect(canTransition(terminal, to)).toBe(false);
    }
  });

  it('a cancelled job can never re-enter the delivery flow', () => {
    for (const to of [
      S.READY_FOR_ASSIGNMENT,
      S.ACCEPTED,
      S.PICKED_UP,
      S.DELIVERED,
      S.MANUAL_QUEUE,
    ]) {
      expect(canTransition(S.CANCELLED, to)).toBe(false);
    }
  });

  it('a picked-up delivery cannot be cancelled or dropped into the manual queue', () => {
    expect(canTransition(S.PICKED_UP, S.CANCELLED)).toBe(false);
    expect(canTransition(S.PICKED_UP, S.MANUAL_QUEUE)).toBe(false);
  });

  it('the manual queue can be re-assigned, returned to the pool, or cancelled', () => {
    expect([...TRANSITIONS[S.MANUAL_QUEUE]].sort()).toEqual(
      [S.AWAITING_CONFIRMATION, S.CANCELLED, S.READY_FOR_ASSIGNMENT].sort(),
    );
  });

  it('assertTransition throws a 409 INVALID_TRANSITION listing what is allowed', () => {
    try {
      assertTransition(S.ACCEPTED, S.DELIVERED);
      expect.unreachable();
    } catch (err) {
      const e = err as { status: number; code: string; details: { allowed: string[] } };
      expect(e.status).toBe(409);
      expect(e.code).toBe('INVALID_TRANSITION');
      expect(e.details.allowed).toContain(S.PICKED_UP);
    }
  });
});
