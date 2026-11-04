import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { newRider, useWorld } from '../helpers/world.js';

useWorld();
const api = request(createApp());

const jobBody = (o: Record<string, unknown> = {}) => ({
  orderId: `API-${Math.random().toString(36).slice(2, 8)}`,
  pickupZone: 'T. Nagar',
  deliveryZone: 'Anna Nagar',
  load: 5,
  priority: 'NORMAL',
  ...o,
});
const asRider = (rider: { id: string; name: string }) => ({
  'X-Actor-Role': 'RIDER',
  'X-Actor-Id': rider.id,
  'X-Actor-Name': rider.name,
});

describe('request validation and error shape', () => {
  it('400 VALIDATION_ERROR lists each bad field', async () => {
    const res = await api.post('/api/jobs').send({
      orderId: 'x',
      pickupZone: 'Atlantis',
      deliveryZone: 'Anna Nagar',
      load: -3,
      priority: 'ASAP',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['orderId', 'pickupZone', 'load', 'priority']));
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    const res = await api.post('/api/jobs').send({ ...jobBody(), status: 'DELIVERED' });
    expect(res.status).toBe(400);
  });

  it('400 for a malformed id, 404 for a well-formed but unknown id, 404 for an unknown route', async () => {
    expect((await api.get('/api/jobs/not-an-id')).status).toBe(400);
    const missing = await api.get('/api/jobs/64b000000000000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect((await api.get('/api/nope')).body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('400 INVALID_JSON for a malformed body', async () => {
    const res = await api
      .post('/api/jobs')
      .set('Content-Type', 'application/json')
      .send('{"orderId":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('422 when the deadline is in the past', async () => {
    const res = await api
      .post('/api/jobs')
      .send(jobBody({ deadline: new Date(Date.now() - 3600_000).toISOString() }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEADLINE_IN_PAST');
  });
});

describe('job creation over HTTP (duplicate protection)', () => {
  it('201 first time, 200 + meta.duplicate on an identical retry, 409 when the reference is reused with other details', async () => {
    const body = jobBody({ orderId: 'HTTP-1' });
    const first = await api.post('/api/jobs').send(body);
    const retry = await api.post('/api/jobs').send(body);
    const clash = await api.post('/api/jobs').send({ ...body, load: 50 });

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ orderId: 'HTTP-1', status: 'READY_FOR_ASSIGNMENT' });
    expect(retry.status).toBe(200);
    expect(retry.body.meta.duplicate).toBe(true);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('DUPLICATE_ORDER_CONFLICT');

    const list = await api.get('/api/jobs?q=http-1');
    expect(list.body.meta.total).toBe(1);
  });
});

describe('response shape', () => {
  it('never leaks internal fields or stamps ids onto sub-documents', async () => {
    const rider = await newRider();
    const created = await api.post('/api/jobs').send(jobBody({ orderId: 'SHAPE-1' }));
    await api.post(`/api/jobs/${created.body.data.id}/assign`).send({ riderId: rider.id });
    const job = (await api.get(`/api/jobs/${created.body.data.id}`)).body.data;
    expect(job).not.toHaveProperty('payloadHash');
    expect(job).not.toHaveProperty('_id');
    expect(job.currentAssignment.assignedBy).toEqual({
      type: 'DISPATCHER',
      id: 'demo-dispatcher',
      name: 'Demo Dispatcher',
    });
    expect(job.currentAssignment.recommendation).not.toHaveProperty('id');
    const events = (await api.get(`/api/jobs/${created.body.data.id}/events`)).body.data;
    expect(events.every((e: { actor: { id: string } }) => e.actor.id !== 'undefined')).toBe(true);
  });
});

describe('listing, search and filters', () => {
  it('filters by status, zone, priority, free-text order id and paginates', async () => {
    await api.post('/api/jobs').send(
      jobBody({
        orderId: 'ALPHA-1',
        pickupZone: 'T. Nagar',
        deliveryZone: 'Adyar',
        priority: 'URGENT',
      }),
    );
    await api.post('/api/jobs').send(
      jobBody({
        orderId: 'ALPHA-2',
        pickupZone: 'Ambattur',
        deliveryZone: 'Porur',
        priority: 'LOW',
      }),
    );
    await api
      .post('/api/jobs')
      .send(jobBody({ orderId: 'BETA-1', pickupZone: 'Ambattur', deliveryZone: 'Ambattur' }));

    expect((await api.get('/api/jobs?q=alpha')).body.meta.total).toBe(2);
    expect((await api.get('/api/jobs?zone=Ambattur')).body.meta.total).toBe(2);
    expect(
      (await api.get('/api/jobs?zone=Porur')).body.data.map((j: { orderId: string }) => j.orderId),
    ).toEqual(['ALPHA-2']);
    expect(
      (await api.get('/api/jobs?priority=URGENT')).body.data.map(
        (j: { orderId: string }) => j.orderId,
      ),
    ).toEqual(['ALPHA-1']);
    expect(
      (await api.get('/api/jobs?status=READY_FOR_ASSIGNMENT,MANUAL_QUEUE')).body.meta.total,
    ).toBe(3);
    expect((await api.get('/api/jobs?status=DELIVERED')).body.meta.total).toBe(0);
    const page = await api.get('/api/jobs?limit=2&page=2&sort=oldest');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect((await api.get('/api/jobs?status=BOGUS')).status).toBe(400);
  });

  it('a regex-looking search string is treated literally', async () => {
    await api.post('/api/jobs').send(jobBody({ orderId: 'A.B-1' }));
    await api.post('/api/jobs').send(jobBody({ orderId: 'AXB-1' }));
    expect((await api.get('/api/jobs?q=A.B')).body.meta.total).toBe(1);
  });
});

describe('end-to-end dispatch over HTTP: the completion criteria', () => {
  it('create → recommend → assign → (timeout) manual queue → reassign → accept → pickup → deliver, with a matching history', async () => {
    const near = await newRider({ name: 'Near Rider', currentZone: 'T. Nagar' });
    const far = await newRider({ name: 'Far Rider', currentZone: 'Anna Nagar' });

    expect(
      (await api.put('/api/system/config').send({ assignmentTimeoutMinutes: 5 })).body.data
        .assignmentTimeoutMinutes,
    ).toBe(5);

    const created = await api.post('/api/jobs').send(jobBody({ orderId: 'FLOW-1', load: 6 }));
    const jobId = created.body.data.id;

    const rec = await api.get(`/api/jobs/${jobId}/recommendations`);
    expect(rec.body.data.candidates.map((c: { riderName: string }) => c.riderName)).toEqual([
      'Near Rider',
      'Far Rider',
    ]);
    expect(rec.body.data.candidates[0].explanation).toMatch(/Recommended over Far Rider/);

    const assigned = await api.post(`/api/jobs/${jobId}/assign`).send({ riderId: near.id });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.job.status).toBe('AWAITING_CONFIRMATION');
    const retried = await api.post(`/api/jobs/${jobId}/assign`).send({ riderId: near.id });
    expect(retried.status).toBe(200);
    expect(retried.body.meta.idempotentReplay).toBe(true);

    const clash = await api
      .post(`/api/jobs/${jobId}/assign`)
      .send({ riderId: far.id, overrideReason: 'trying anyway' })
      .set('X-Actor-Name', 'Second Dispatcher');
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/reassign/);

    await api.post('/api/system/clock/advance').send({ minutes: 6 });
    const sweep = await api.post('/api/system/sweep');
    expect(sweep.body.data.timeouts.expired).toBe(1);

    const queue = await api.get('/api/manual-queue');
    expect(queue.body.data.map((j: { orderId: string }) => j.orderId)).toEqual(['FLOW-1']);
    expect(queue.body.data[0]).toMatchObject({
      status: 'MANUAL_QUEUE',
      failedAttempts: 1,
      manualQueue: { reason: 'ASSIGNMENT_TIMEOUT' },
    });

    const investigation = await api.get(`/api/manual-queue/${jobId}`);
    expect(investigation.body.data.assignments[0].status).toBe('EXPIRED');
    expect(investigation.body.data.recommendation.candidates[0].riderName).toBe('Far Rider');

    const second = await api.post(`/api/jobs/${jobId}/assign`).send({ riderId: far.id });
    expect(second.status).toBe(201);
    const assignmentId = second.body.data.assignment.id;

    expect(
      (await api.post(`/api/assignments/${assignmentId}/accept`).set(asRider(near))).status,
    ).toBe(403);
    expect(
      (await api.post(`/api/assignments/${assignmentId}/accept`).set(asRider(far))).body.data.job
        .status,
    ).toBe('ACCEPTED');

    const early = await api.post(`/api/jobs/${jobId}/deliver`).set(asRider(far));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    expect(
      (await api.post(`/api/jobs/${jobId}/pickup`).set(asRider(far))).body.data.job.status,
    ).toBe('PICKED_UP');
    expect(
      (await api.post(`/api/jobs/${jobId}/deliver`).set(asRider(far))).body.data.job.status,
    ).toBe('DELIVERED');

    const events = (await api.get(`/api/jobs/${jobId}/events`)).body.data;
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'JOB_CREATED',
      'JOB_READY',
      'RIDER_ASSIGNED',
      'ASSIGNMENT_EXPIRED',
      'MOVED_TO_MANUAL_QUEUE',
      'RIDER_ASSIGNED',
      'ASSIGNMENT_ACCEPTED',
      'PICKED_UP',
      'DELIVERED',
    ]);
    expect(
      events.every((e: { actor?: { name: string }; at: string }) => e.actor?.name && e.at),
    ).toBe(true);
    expect(
      (await api.get(`/api/jobs/${jobId}/assignments`)).body.data.map(
        (a: { status: string }) => a.status,
      ),
    ).toEqual(['EXPIRED', 'COMPLETED']);

    const dash = (await api.get('/api/dashboard')).body.data;
    expect(dash.totals).toMatchObject({ received: 1, completed: 1, manualQueue: 0, inProgress: 0 });
    expect((await api.get('/api/system/integrity')).body.data.ok).toBe(true);
  });

  it('reports rider workload and answers "can this rider take another delivery?"', async () => {
    const rider = await newRider({ name: 'Check Me', capacity: 10 });
    const created = await api.post('/api/jobs').send(jobBody({ load: 8 }));
    await api.post(`/api/jobs/${created.body.data.id}/assign`).send({ riderId: rider.id });

    const detail = (await api.get(`/api/riders/${rider.id}`)).body.data;
    expect(detail).toMatchObject({
      reservedLoad: 8,
      availableCapacity: 2,
      openSlots: 2,
      canTakeAnotherDelivery: true,
    });
    expect(detail.activeAssignments).toHaveLength(1);

    const fits = (
      await api.get(
        `/api/riders/${rider.id}/fit?pickupZone=T. Nagar&deliveryZone=Anna Nagar&load=2`,
      )
    ).body.data;
    const tooBig = (
      await api.get(
        `/api/riders/${rider.id}/fit?pickupZone=T. Nagar&deliveryZone=Anna Nagar&load=5`,
      )
    ).body.data;
    const wrongZone = (
      await api.get(
        `/api/riders/${rider.id}/fit?pickupZone=Ambattur&deliveryZone=Anna Nagar&load=1`,
      )
    ).body.data;
    expect(fits.canTake).toBe(true);
    expect(tooBig).toMatchObject({ canTake: false, reasons: [{ code: 'INSUFFICIENT_CAPACITY' }] });
    expect(wrongZone.reasons[0].code).toBe('PICKUP_ZONE_NOT_SERVED');
  });

  it('refuses to shrink a rider below what they already carry', async () => {
    const rider = await newRider({ capacity: 10 });
    const created = await api.post('/api/jobs').send(jobBody({ load: 8 }));
    await api.post(`/api/jobs/${created.body.data.id}/assign`).send({ riderId: rider.id });
    const res = await api.patch(`/api/riders/${rider.id}`).send({ capacity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPACITY_BELOW_COMMITTED');
    expect(
      (await api.patch(`/api/riders/${rider.id}`).send({ availability: 'OFFLINE' })).body.data
        .availability,
    ).toBe('OFFLINE');
  });

  it('cancel requires a reason and the job then shows as cancelled', async () => {
    const created = await api.post('/api/jobs').send(jobBody());
    const id = created.body.data.id;
    expect((await api.post(`/api/jobs/${id}/cancel`).send({})).status).toBe(400);
    const done = await api.post(`/api/jobs/${id}/cancel`).send({ reason: 'Customer called' });
    expect(done.body.data.job).toMatchObject({
      status: 'CANCELLED',
      cancellation: { reason: 'Customer called' },
    });
  });
});
