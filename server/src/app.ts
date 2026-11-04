import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { actorFromHeaders, errorHandler, notFoundHandler } from './middleware/http.js';
import { jobsRouter } from './routes/jobs.js';
import {
  assignmentsRouter,
  ridersRouter,
  queueRouter,
  dashboardRouter,
  metaRouter,
  systemRouter,
} from './routes/others.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin.split(','),
      allowedHeaders: ['Content-Type', 'X-Actor-Name', 'X-Actor-Role', 'X-Actor-Id'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') ?? crypto.randomUUID().slice(0, 8);
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  if (!env.isTest) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  const api = express.Router();
  api.use(actorFromHeaders);
  api.use('/meta', metaRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/jobs', jobsRouter);
  api.use('/assignments', assignmentsRouter);
  api.use('/riders', ridersRouter);
  api.use('/manual-queue', queueRouter);
  api.use('/system', systemRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
