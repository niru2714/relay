import { Router, type NextFunction, type Request, type Response } from 'express';
import { asyncHandler, validate } from '../middleware/http.js';
import * as v from '../validation/schemas.js';
import { presentJob } from '../services/jobService.js';
import type { AssignmentDoc, JobDoc } from '../models/index.js';
import * as assignments from '../services/assignmentService.js';
import * as riders from '../services/riderService.js';
import * as queue from '../services/queueService.js';
import { getDashboard } from '../services/dashboardService.js';
import * as integrity from '../services/integrityService.js';
import { runMaintenance } from '../services/timeoutService.js';
import { clearAllData, seedDemoData } from '../services/seedService.js';
import { settings } from '../config/settings.js';
import { env } from '../config/env.js';
import { clock } from '../lib/clock.js';
import { AppError } from '../lib/errors.js';
import { ZONE_NAMES, ZONES, travelMinutes } from '../domain/travel.js';
import { JOB_STATUSES, PRIORITIES, AVAILABILITIES, VEHICLES } from '../domain/constants.js';
import { TRANSITIONS } from '../domain/jobStateMachine.js';
import { WEIGHTS } from '../domain/ranking.js';

export const assignmentsRouter = Router();

const present = async (
  res: Response,
  status: number,
  result: { assignment?: AssignmentDoc | null; job?: JobDoc | null; replay?: boolean },
) =>
  res.status(result.replay ? 200 : status).json({
    data: {
      assignment: result.assignment?.toJSON() ?? null,
      job: result.job ? await presentJob(result.job) : null,
    },
    meta: result.replay ? { idempotentReplay: true } : {},
  });

assignmentsRouter.post(
  '/:id/accept',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) =>
    present(res, 200, await assignments.accept({ assignmentId: req.params.id, actor: req.actor })),
  ),
);

assignmentsRouter.post(
  '/:id/reject',
  validate({ params: v.idParam, body: v.optionalReasonBody }),
  asyncHandler(async (req, res) =>
    present(
      res,
      200,
      await assignments.reject({
        assignmentId: req.params.id,
        actor: req.actor,
        reason: req.valid.body.reason,
      }),
    ),
  ),
);

assignmentsRouter.post(
  '/:id/withdraw',
  validate({ params: v.idParam, body: v.optionalReasonBody }),
  asyncHandler(async (req, res) =>
    present(
      res,
      200,
      await assignments.withdraw({
        assignmentId: req.params.id,
        actor: req.actor,
        reason: req.valid.body.reason,
      }),
    ),
  ),
);

export const ridersRouter = Router();

ridersRouter.get(
  '/',
  validate({ query: v.listRidersQuery }),
  asyncHandler(async (req, res) => res.json({ data: await riders.listRiders(req.valid.query) })),
);

ridersRouter.post(
  '/',
  validate({ body: v.createRiderBody }),
  asyncHandler(async (req, res) =>
    res.status(201).json({ data: await riders.createRider(req.valid.body) }),
  ),
);

ridersRouter.get(
  '/:id',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => res.json({ data: await riders.getRider(req.params.id) })),
);

ridersRouter.patch(
  '/:id',
  validate({ params: v.idParam, body: v.updateRiderBody }),
  asyncHandler(async (req, res) =>
    res.json({ data: await riders.updateRider(req.params.id, req.valid.body) }),
  ),
);

ridersRouter.get(
  '/:id/fit',
  validate({ params: v.idParam, query: v.fitQuery }),
  asyncHandler(async (req, res) =>
    res.json({ data: await riders.checkFit(req.params.id, req.valid.query) }),
  ),
);

export const queueRouter = Router();
queueRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const data = await queue.listManualQueue();
    res.json({ data, meta: { total: data.length } });
  }),
);
queueRouter.get(
  '/:jobId',
  validate({ params: v.jobIdParam }),
  asyncHandler(async (req, res) => res.json({ data: await queue.investigate(req.params.jobId) })),
);

export const dashboardRouter = Router();
dashboardRouter.get(
  '/',
  asyncHandler(async (_req, res) => res.json({ data: await getDashboard() })),
);

export const metaRouter = Router();
metaRouter.get('/', (_req, res) =>
  res.json({
    data: {
      zones: ZONE_NAMES.map((name) => ({ name, ...ZONES[name] })),
      travelMinutes: Object.fromEntries(
        ZONE_NAMES.map((a) => [
          a,
          Object.fromEntries(ZONE_NAMES.map((b) => [b, travelMinutes(a, b)])),
        ]),
      ),
      statuses: JOB_STATUSES,
      transitions: TRANSITIONS,
      priorities: PRIORITIES,
      availabilities: AVAILABILITIES,
      vehicles: VEHICLES,
      rankingWeights: WEIGHTS,
      config: {
        ...settings.get(),
        simulatedClock: clock.isSimulated(),
        clockOffsetMinutes: clock.offsetMinutes(),
        demoEndpoints: env.enableDemoEndpoints,
      },
    },
  }),
);

export const systemRouter = Router();
const demoOnly = (_req: Request, _res: Response, next: NextFunction) =>
  env.enableDemoEndpoints
    ? next()
    : next(
        new AppError(
          403,
          'DEMO_ENDPOINTS_DISABLED',
          'Demo controls are disabled in this environment',
        ),
      );
const snapshot = () => ({
  ...settings.get(),
  now: clock.now(),
  simulatedClock: clock.isSimulated(),
  clockOffsetMinutes: clock.offsetMinutes(),
});

systemRouter.get('/config', (_req, res) => res.json({ data: snapshot() }));
systemRouter.put('/config', demoOnly, validate({ body: v.configBody }), (req, res) => {
  settings.update(req.valid.body);
  res.json({ data: snapshot() });
});
systemRouter.post(
  '/clock/advance',
  demoOnly,
  validate({ body: v.advanceClockBody }),
  (req, res) => {
    clock.advanceMinutes(req.valid.body.minutes);
    res.json({ data: snapshot() });
  },
);
systemRouter.post('/clock/reset', demoOnly, (_req, res) => {
  clock.reset();
  res.json({ data: snapshot() });
});
systemRouter.post(
  '/sweep',
  asyncHandler(async (_req, res) => res.json({ data: await runMaintenance() })),
);
systemRouter.get(
  '/integrity',
  asyncHandler(async (_req, res) => res.json({ data: await integrity.check() })),
);
systemRouter.post(
  '/integrity/repair',
  demoOnly,
  asyncHandler(async (_req, res) => res.json({ data: await integrity.repairLedger() })),
);
systemRouter.post(
  '/clear',
  demoOnly,
  asyncHandler(async (_req, res) => {
    await clearAllData();
    res.json({ data: snapshot() });
  }),
);
systemRouter.post(
  '/reset-demo',
  demoOnly,
  asyncHandler(async (_req, res) => {
    await seedDemoData({ reset: true });
    res.json({ data: snapshot() });
  }),
);
