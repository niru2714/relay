import { Router, type Response } from 'express';
import type { JobDoc } from '../models/index.js';
import type { JobDTO } from '../services/jobService.js';
import { asyncHandler, validate } from '../middleware/http.js';
import * as v from '../validation/schemas.js';
import { Job } from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { getJob, listJobs, presentJob } from '../services/jobService.js';
import { listEvents } from '../services/eventService.js';
import { recommendForJob } from '../services/recommendationService.js';
import * as assignments from '../services/assignmentService.js';
import * as delivery from '../services/deliveryService.js';
import * as queue from '../services/queueService.js';
import * as dispatch from '../services/dispatchService.js';

export const jobsRouter = Router();

const respond = (
  res: Response,
  status: number,
  {
    job,
    assignment,
    replay,
    ...rest
  }: { job: JobDTO; assignment?: unknown; replay?: boolean } & Record<string, unknown>,
) =>
  res.status(replay ? 200 : status).json({
    data: { job, assignment },
    meta: { ...(replay ? { idempotentReplay: true } : {}), ...rest },
  });

jobsRouter.post(
  '/',
  validate({ body: v.createJobBody }),
  asyncHandler(async (req, res) => {
    const {
      job,
      duplicate,
      dispatch: outcome,
    } = await dispatch.submitJob(req.valid.body, req.actor);
    res.status(duplicate ? 200 : 201).json({
      data: await presentJob(job),
      meta: { duplicate, ...(outcome ? { dispatch: outcome } : {}) },
    });
  }),
);

jobsRouter.get(
  '/',
  validate({ query: v.listJobsQuery }),
  asyncHandler(async (req, res) => res.json(await listJobs(req.valid.query))),
);

jobsRouter.get(
  '/:id',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => res.json({ data: await getJob(req.params.id) })),
);

jobsRouter.get(
  '/:id/events',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    if (!(await Job.exists({ _id: req.params.id }))) throw notFound('Job', req.params.id);
    res.json({ data: await listEvents(req.params.id) });
  }),
);

jobsRouter.get(
  '/:id/assignments',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    if (!(await Job.exists({ _id: req.params.id }))) throw notFound('Job', req.params.id);
    res.json({ data: await assignments.listAssignmentsForJob(req.params.id) });
  }),
);

jobsRouter.get(
  '/:id/recommendations',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw notFound('Job', req.params.id);
    res.json({ data: await recommendForJob(job) });
  }),
);

jobsRouter.post(
  '/:id/assign',
  validate({ params: v.idParam, body: v.assignBody }),
  asyncHandler(async (req, res) => {
    const result = await assignments.assign({
      jobId: req.params.id,
      ...req.valid.body,
      actor: req.actor,
    });
    respond(res, 201, {
      ...result,
      job: await presentJob(result.job),
      assignment: result.assignment?.toJSON(),
    });
  }),
);

jobsRouter.post(
  '/:id/reassign',
  validate({ params: v.idParam, body: v.reassignBody }),
  asyncHandler(async (req, res) => {
    const result = await assignments.reassign({
      jobId: req.params.id,
      ...req.valid.body,
      actor: req.actor,
    });
    respond(res, 201, {
      ...result,
      job: await presentJob(result.job),
      assignment: result.assignment?.toJSON(),
    });
  }),
);

jobsRouter.post(
  '/:id/auto-assign',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    const outcome = await dispatch.autoAssign(req.params.id, req.actor);
    const job = (await Job.findById(req.params.id)) as JobDoc;
    res.status(outcome.assigned ? 201 : 200).json({
      data: { job: await presentJob(job), assignment: outcome.assignment?.toJSON() ?? null },
      meta: { assigned: outcome.assigned, reason: outcome.reason ?? null },
    });
  }),
);

jobsRouter.post(
  '/:id/pickup',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    const result = await delivery.pickUp({ jobId: req.params.id, actor: req.actor });
    respond(res, 200, { ...result, job: await presentJob(result.job) });
  }),
);

jobsRouter.post(
  '/:id/deliver',
  validate({ params: v.idParam }),
  asyncHandler(async (req, res) => {
    const result = await delivery.deliver({ jobId: req.params.id, actor: req.actor });
    respond(res, 200, { ...result, job: await presentJob(result.job) });
  }),
);

jobsRouter.post(
  '/:id/cancel',
  validate({ params: v.idParam, body: v.reasonBody }),
  asyncHandler(async (req, res) => {
    const result = await delivery.cancel({
      jobId: req.params.id,
      actor: req.actor,
      reason: req.valid.body.reason,
    });
    respond(res, 200, { ...result, job: await presentJob(result.job) });
  }),
);

jobsRouter.post(
  '/:id/escalate',
  validate({ params: v.idParam, body: v.reasonBody }),
  asyncHandler(async (req, res) => {
    const result = await queue.escalate({
      jobId: req.params.id,
      actor: req.actor,
      reason: req.valid.body.reason,
    });
    respond(res, 200, { ...result, job: await presentJob(result.job) });
  }),
);

jobsRouter.post(
  '/:id/requeue',
  validate({ params: v.idParam, body: v.requeueBody }),
  asyncHandler(async (req, res) => {
    const result = await queue.requeue({
      jobId: req.params.id,
      actor: req.actor,
      note: req.valid.body.note,
    });
    respond(res, 200, { ...result, job: await presentJob(result.job) });
  }),
);
