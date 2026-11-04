import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { ACTOR_TYPE, type ActorType } from '../domain/constants.js';
import type { Actor } from '../domain/types.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    actor: Actor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    valid: { params?: any; query?: any; body?: any };
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export const validate =
  (schemas: { params?: ZodTypeAny; query?: ZodTypeAny; body?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    try {
      req.valid = {};
      for (const part of ['params', 'query', 'body'] as const) {
        const schema = schemas[part];
        if (schema) req.valid[part] = schema.parse(req[part] ?? {});
      }
      next();
    } catch (err) {
      next(err);
    }
  };

export function actorFromHeaders(req: Request, _res: Response, next: NextFunction) {
  const role = String(req.get('x-actor-role') ?? ACTOR_TYPE.DISPATCHER).toUpperCase();
  const type: ActorType = (Object.values(ACTOR_TYPE) as string[]).includes(role)
    ? (role as ActorType)
    : ACTOR_TYPE.DISPATCHER;
  const name = (
    req.get('x-actor-name') ?? (type === ACTOR_TYPE.DISPATCHER ? 'Demo Dispatcher' : type)
  ).slice(0, 80);
  req.actor = { type, id: req.get('x-actor-id') ?? name.toLowerCase().replace(/\s+/g, '-'), name };
  next();
}
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let body: { code: string; message: string; details?: unknown } = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong on our side',
  };
  if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid',
      details: err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
    };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: err.message,
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { code: 'VALIDATION_ERROR', message: `Invalid value for ${err.path}` };
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  } else if ((err as { code?: number })?.code === 11000) {
    status = 409;
    body = {
      code: 'DUPLICATE',
      message: 'A record with the same unique value already exists',
      details: (err as { keyValue?: unknown }).keyValue,
    };
  }
  if (status >= 500 && process.env.NODE_ENV !== 'test') console.error(`[${req.id}]`, err);
  res.status(status).json({ error: { ...body, requestId: req.id } });
}
