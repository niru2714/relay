import { z } from 'zod';
import { AVAILABILITIES, JOB_STATUSES, PRIORITIES, VEHICLES } from '../domain/constants.js';
import { ZONE_ENUM, ZONE_NAMES } from '../domain/travel.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a 24-character id');
export const idParam = z.object({ id: objectId });
export const jobIdParam = z.object({ jobId: objectId });

const zone = z.enum(ZONE_ENUM, {
  errorMap: () => ({ message: `Must be one of: ${ZONE_NAMES.join(', ')}` }),
});
const reason = z.string().trim().min(3, 'Please give a short reason (3+ characters)').max(300);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO-8601 date-time, e.g. 2026-11-03T18:30:00Z' })
  .transform((s) => new Date(s));

export const createJobBody = z
  .object({
    orderId: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
    pickupZone: zone,
    deliveryZone: zone,
    load: z.number({ invalid_type_error: 'Must be a number' }).int().min(1).max(500),
    priority: z.enum(PRIORITIES).default('NORMAL'),
    deadline: isoDate.nullish(),
    customerName: optionalText(80),
    notes: optionalText(500),
  })
  .strict();

const csv = <T extends [string, ...string[]]>(allowed: T) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(allowed)));

export const listJobsQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: csv(JOB_STATUSES).optional(),
  zone: zone.optional(),
  pickupZone: zone.optional(),
  deliveryZone: zone.optional(),
  priority: z.enum(PRIORITIES).optional(),
  riderId: objectId.optional(),
  attention: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['newest', 'oldest', 'priority', 'deadline']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const assignBody = z
  .object({ riderId: objectId, overrideReason: reason.optional() })
  .strict();

export const reassignBody = z
  .object({ riderId: objectId, reason, expectedAssignmentId: objectId.optional() })
  .strict();

export const reasonBody = z.object({ reason }).strict();
export const optionalReasonBody = z.object({ reason: reason.optional() }).strict();
export const requeueBody = z.object({ note: optionalText(300) }).strict();

export const createRiderBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: optionalText(30),
    vehicle: z.enum(VEHICLES).default('SCOOTER'),
    zones: z
      .array(zone)
      .min(1)
      .transform((list) => [...new Set(list)]),
    homeZone: zone.optional(),
    currentZone: zone.optional(),
    availability: z.enum(AVAILABILITIES).default('AVAILABLE'),
    capacity: z.number().int().min(1).max(500),
    maxConcurrentJobs: z.number().int().min(1).max(20),
  })
  .strict();

export const updateRiderBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: optionalText(30),
    vehicle: z.enum(VEHICLES),
    zones: z
      .array(zone)
      .min(1)
      .transform((list) => [...new Set(list)]),
    currentZone: zone,
    availability: z.enum(AVAILABILITIES),
    capacity: z.number().int().min(1).max(500),
    maxConcurrentJobs: z.number().int().min(1).max(20),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const listRidersQuery = z.object({
  availability: z.enum(AVAILABILITIES).optional(),
  zone: zone.optional(),
});

export const fitQuery = z.object({
  pickupZone: zone,
  deliveryZone: zone,
  load: z.coerce.number().int().min(1).max(500),
});

export const configBody = z
  .object({
    assignmentTimeoutMinutes: z.number().min(0.05, 'At least 3 seconds').max(1440),
    autoDispatch: z.boolean(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one setting');

export const advanceClockBody = z
  .object({
    minutes: z
      .number()
      .min(0.1)
      .max(60 * 24 * 7),
  })
  .strict();
