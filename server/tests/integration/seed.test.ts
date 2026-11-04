import { describe, expect, it } from 'vitest';
import { useWorld, reload } from '../helpers/world.js';
import { seedDemoData } from '../../src/services/seedService.js';
import { getDashboard } from '../../src/services/dashboardService.js';
import { listManualQueue } from '../../src/services/queueService.js';
import { Job } from '../../src/models/index.js';
import * as integrity from '../../src/services/integrityService.js';
import { listEvents } from '../../src/services/eventService.js';
import { clock } from '../../src/lib/clock.js';

useWorld();

describe('demo seed', () => {
  it('replays a realistic history that is internally consistent and covers every state', async () => {
    const summary = await seedDemoData();
    expect(summary).toEqual({ jobs: 13, riders: 8 });
    expect(clock.isSimulated()).toBe(false);

    const dash = await getDashboard();
    expect(dash.totals.received).toBe(13);
    expect(dash.byStatus).toMatchObject({
      DELIVERED: 2,
      CANCELLED: 1,
      MANUAL_QUEUE: 2,
      PICKED_UP: 1,
      ACCEPTED: 1,
      AWAITING_CONFIRMATION: 2,
      READY_FOR_ASSIGNMENT: 4,
    });
    expect(dash.attention.critical).toBeGreaterThanOrEqual(3);

    const reasons = (await listManualQueue()).map((j) => j.manualQueue!.reason).sort();
    expect(reasons).toEqual(['ASSIGNMENT_TIMEOUT', 'RIDER_REJECTED']);

    const stuck = await Job.findOne({ orderId: 'RLY-1012' });
    expect(stuck!.flags!.noEligibleRiderSince).toBeTruthy();

    const reassigned = await Job.findOne({ orderId: 'RLY-1005' });
    const types = (await listEvents(reassigned!._id)).map((e) => e.type);
    expect(types).toContain('RIDER_REASSIGNED');
    expect(reassigned!.status).toBe('DELIVERED');

    expect((await integrity.check()).ok).toBe(true);
  });

  it('can be reset repeatedly', async () => {
    await seedDemoData();
    await seedDemoData({ reset: true });
    expect(await Job.countDocuments()).toBe(13);
    expect((await integrity.check()).ok).toBe(true);
    expect(await reload.events((await Job.findOne({ orderId: 'RLY-1001' }))!._id)).toHaveLength(6);
  });
});
