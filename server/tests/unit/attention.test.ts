import { describe, expect, it } from 'vitest';
import { computeAttention } from '../../src/domain/attention.js';
import type { AttentionJob } from '../../src/domain/types.js';

const NOW = new Date('2026-01-01T10:00:00Z');
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const job = (o: Partial<AttentionJob>): AttentionJob => ({
  status: 'NEW' as const,
  priority: 'NORMAL',
  createdAt: min(-5),
  updatedAt: min(-5),
  ...o,
});
const codes = (j: AttentionJob) => computeAttention(j, { now: NOW }).map((i) => i.code);

describe('attention rules', () => {
  it('flags the manual queue as critical with the reason', () => {
    const items = computeAttention(
      job({
        status: 'MANUAL_QUEUE',
        manualQueue: { reason: 'ASSIGNMENT_TIMEOUT', enteredAt: min(-12) },
      }),
      { now: NOW },
    );
    expect(items[0]).toMatchObject({ code: 'IN_MANUAL_QUEUE', severity: 'critical' });
    expect(items[0].message).toMatch(/did not confirm.*12 min/);
  });

  it('flags a ready job that has no eligible rider', () => {
    expect(
      codes(job({ status: 'READY_FOR_ASSIGNMENT', flags: { noEligibleRiderSince: min(-1) } })),
    ).toContain('NO_ELIGIBLE_RIDER');
  });

  it('flags an unassigned job sooner when it is urgent', () => {
    const waiting = {
      status: 'READY_FOR_ASSIGNMENT' as const,
      updatedAt: min(-8),
      createdAt: min(-8),
    };
    expect(codes(job({ ...waiting, priority: 'URGENT' }))).toContain('UNASSIGNED_TOO_LONG');
    expect(codes(job({ ...waiting, priority: 'NORMAL' }))).not.toContain('UNASSIGNED_TOO_LONG');
  });

  it('warns when a confirmation is about to expire', () => {
    const j = job({
      status: 'AWAITING_CONFIRMATION',
      assignedAt: min(-100),
      assignmentExpiresAt: min(20),
    });
    expect(codes(j)).toContain('CONFIRMATION_EXPIRING');
    expect(codes({ ...j, assignedAt: min(-10), assignmentExpiresAt: min(110) })).not.toContain(
      'CONFIRMATION_EXPIRING',
    );
  });

  it('flags a missed deadline as critical and a close one as a warning', () => {
    expect(
      computeAttention(job({ status: 'ACCEPTED', deadline: min(-5) }), { now: NOW })[0],
    ).toMatchObject({ code: 'DEADLINE_MISSED', severity: 'critical' });
    expect(codes(job({ status: 'READY_FOR_ASSIGNMENT', deadline: min(20) }))).toContain(
      'DEADLINE_AT_RISK',
    );
    expect(codes(job({ status: 'PICKED_UP', deadline: min(20) }))).not.toContain(
      'DEADLINE_AT_RISK',
    );
  });

  it('finished jobs never need attention', () => {
    expect(codes(job({ status: 'DELIVERED', deadline: min(-500) }))).toEqual([]);
    expect(codes(job({ status: 'CANCELLED' }))).toEqual([]);
  });
});
