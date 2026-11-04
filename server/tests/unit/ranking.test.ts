import { describe, expect, it } from 'vitest';
import { evaluateEligibility, rankRiders } from '../../src/domain/ranking.js';
import { travelMinutes } from '../../src/domain/travel.js';
import type { JobRequirements, RiderPlain } from '../../src/domain/types.js';

const NOW = new Date('2026-01-01T10:00:00Z');
const rider = (id: string, o: Partial<RiderPlain> = {}): RiderPlain => ({
  id,
  name: `Rider-${id}`,
  vehicle: 'SCOOTER',
  zones: ['T. Nagar', 'Anna Nagar'],
  currentZone: 'T. Nagar',
  availability: 'AVAILABLE',
  capacity: 20,
  maxConcurrentJobs: 4,
  activeLoad: 0,
  reservedLoad: 0,
  activeJobs: 0,
  pendingJobs: 0,
  ...o,
});
const job = (o: Partial<JobRequirements> = {}): JobRequirements => ({
  pickupZone: 'T. Nagar',
  deliveryZone: 'Anna Nagar',
  load: 5,
  priority: 'NORMAL',
  ...o,
});

describe('eligibility (hard rules)', () => {
  it('accepts a healthy rider', () => {
    expect(evaluateEligibility(rider('a'), job()).eligible).toBe(true);
  });

  it.each<[string, Partial<RiderPlain>, string]>([
    ['unavailable', { availability: 'OFFLINE' }, 'UNAVAILABLE'],
    ['on break', { availability: 'ON_BREAK' }, 'UNAVAILABLE'],
    ['pickup zone not served', { zones: ['Anna Nagar'] }, 'PICKUP_ZONE_NOT_SERVED'],
    ['delivery zone not served', { zones: ['T. Nagar'] }, 'DELIVERY_ZONE_NOT_SERVED'],
    ['insufficient capacity', { activeLoad: 17 }, 'INSUFFICIENT_CAPACITY'],
    ['reserved capacity counts too', { reservedLoad: 16 }, 'INSUFFICIENT_CAPACITY'],
    ['no free slot', { activeJobs: 3, pendingJobs: 1 }, 'NO_FREE_SLOT'],
  ])('rejects: %s', (_label, patch, code) => {
    const result = evaluateEligibility(rider('a', patch), job());
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain(code);
  });

  it('reports every failed rule, not just the first', () => {
    const result = evaluateEligibility(
      rider('a', { availability: 'OFFLINE', zones: ['Ambattur'] }),
      job(),
    );
    expect(result.reasons.map((r) => r.code)).toEqual([
      'UNAVAILABLE',
      'PICKUP_ZONE_NOT_SERVED',
      'DELIVERY_ZONE_NOT_SERVED',
    ]);
  });

  it('exactly-fitting capacity is allowed', () => {
    expect(evaluateEligibility(rider('a', { activeLoad: 15 }), job({ load: 5 })).eligible).toBe(
      true,
    );
  });

  it('excludes a rider who rejected this job earlier', () => {
    const result = evaluateEligibility(rider('a'), job(), { priorAttempts: { a: 'REJECTED' } });
    expect(result.reasons.map((r) => r.code)).toContain('PREVIOUSLY_REJECTED');
  });
});

describe('ranking (soft score)', () => {
  it('puts the closest rider first when other factors are equal', () => {
    const near = rider('near', { currentZone: 'T. Nagar' });
    const far = rider('far', { currentZone: 'Anna Nagar' });
    const { candidates } = rankRiders(job(), [far, near], { now: NOW });
    expect(candidates.map((c) => c.riderId)).toEqual(['near', 'far']);
    expect(candidates[0].explanation).toMatch(/Recommended over Rider-far/);
    expect(candidates[1].explanation).toMatch(/Ranked below Rider-near/);
  });

  it('prefers the lighter workload when travel is equal', () => {
    const busy = rider('busy', { activeJobs: 3, activeLoad: 6 });
    const idle = rider('idle');
    expect(rankRiders(job(), [busy, idle], { now: NOW }).candidates[0].riderId).toBe('idle');
  });

  it('right-sizes: a small rider beats a van for a small load, all else equal', () => {
    const bike = rider('bike', { capacity: 10 });
    const van = rider('van', { capacity: 60 });
    expect(rankRiders(job({ load: 5 }), [van, bike], { now: NOW }).candidates[0].riderId).toBe(
      'bike',
    );
  });

  it('weights travel more heavily for URGENT jobs than for NORMAL ones', () => {
    const close = rider('close', { currentZone: 'T. Nagar', activeJobs: 3, activeLoad: 3 });
    const free = rider('free', { currentZone: 'Anna Nagar' });
    const normal = rankRiders(job({ priority: 'NORMAL' }), [close, free], {
      now: NOW,
    }).candidates.map((c) => c.riderId);
    const urgent = rankRiders(job({ priority: 'URGENT' }), [close, free], {
      now: NOW,
    }).candidates.map((c) => c.riderId);
    expect(normal[0]).toBe('free');
    expect(urgent[0]).toBe('close');
  });

  it('flags and down-ranks a rider whose ETA misses the deadline', () => {
    const soon = new Date(NOW.getTime() + 20 * 60_000);
    const far = rider('far', { currentZone: 'Anna Nagar' });
    const near = rider('near', { currentZone: 'T. Nagar' });
    const { candidates } = rankRiders(
      job({ deadline: soon, pickupZone: 'T. Nagar', deliveryZone: 'Anna Nagar' }),
      [far, near],
      { now: NOW },
    );
    const farCandidate = candidates.find((c) => c.riderId === 'far');
    expect(travelMinutes('Anna Nagar', 'T. Nagar')).toBeGreaterThan(5);
    expect(candidates[0].riderId).toBe('near');
    expect(farCandidate!.deadline?.atRisk || farCandidate!.score < candidates[0]!.score).toBe(true);
  });

  it('penalises (but does not exclude) a rider who let this job expire before', () => {
    const a = rider('a');
    const b = rider('b');
    const { candidates } = rankRiders(job(), [a, b], { now: NOW, priorAttempts: { a: 'EXPIRED' } });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].riderId).toBe('b');
    expect(candidates[1].warnings.join(' ')).toMatch(/earlier assignment/);
  });

  it('is deterministic: ties break on fewer open jobs, then name', () => {
    const a = rider('a');
    const b = rider('b');
    const first = rankRiders(job(), [a, b], { now: NOW }).candidates.map((c) => c.riderId);
    const second = rankRiders(job(), [b, a], { now: NOW }).candidates.map((c) => c.riderId);
    expect(first).toEqual(second);
  });

  it('returns ineligible riders with reasons and an empty candidate list when nobody qualifies', () => {
    const result = rankRiders(
      job(),
      [rider('a', { availability: 'OFFLINE' }), rider('b', { capacity: 2 })],
      { now: NOW },
    );
    expect(result.candidates).toEqual([]);
    expect(result.ineligible).toHaveLength(2);
    expect(result.ineligible[0].reasons.length).toBeGreaterThan(0);
  });

  it('a lone eligible rider is explained as such', () => {
    const { candidates } = rankRiders(
      job(),
      [rider('a'), rider('b', { availability: 'OFFLINE' })],
      { now: NOW },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].explanation).toMatch(/Only eligible rider/);
  });

  it('scores stay within 0–100 and expose the per-factor breakdown', () => {
    const [c] = rankRiders(job(), [rider('a')], { now: NOW }).candidates;
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(100);
    expect(Object.keys(c.breakdown).sort()).toEqual(['deadline', 'fit', 'travel', 'workload']);
  });
});
