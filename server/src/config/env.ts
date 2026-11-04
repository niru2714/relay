import 'dotenv/config';

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === ''
    ? fallback
    : ['1', 'true', 'yes'].includes(String(value).toLowerCase());
const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value === undefined || value === '' || Number.isNaN(n) ? fallback : n;
};

const nodeEnv = process.env.NODE_ENV ?? 'development';
const mongoUri = process.env.MONGODB_URI ?? '';

export const env = Object.freeze({
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: num(process.env.PORT, 5001),
  mongoUri,
  useMemoryDb: !mongoUri,
  seedOnStart: bool(process.env.SEED_ON_START, false),
  assignmentTimeoutMinutes: num(process.env.ASSIGNMENT_TIMEOUT_MINUTES, 120),
  autoDispatch: bool(process.env.AUTO_DISPATCH, false),
  sweepIntervalMs: num(process.env.SWEEP_INTERVAL_MS, 5000),
  enableDemoEndpoints: bool(process.env.ENABLE_DEMO_ENDPOINTS, nodeEnv !== 'production'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
});
