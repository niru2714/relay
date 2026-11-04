import { Job, Rider, Assignment, JobEvent } from '../models/index.js';
import type { Actor, CreateJobInput, CreateRiderInput } from './types.js';
import { settings } from '../config/settings.js';
import { clock } from '../lib/clock.js';
import { dispatcherActor, riderActor } from '../lib/actors.js';
import { createRider } from './riderService.js';
import { createJob } from './jobService.js';
import { recommendForJob } from './recommendationService.js';
import * as assignments from './assignmentService.js';
import * as delivery from './deliveryService.js';
import { evaluateReadyJob } from './dispatchService.js';
import { processExpired } from './timeoutService.js';

const RIDERS = [
  {
    name: 'Arjun Mehta',
    vehicle: 'SCOOTER',
    zones: ['T. Nagar', 'Adyar', 'Guindy', 'Anna Nagar'],
    currentZone: 'T. Nagar',
    capacity: 20,
    maxConcurrentJobs: 4,
  },
  {
    name: 'Priya Nair',
    vehicle: 'BIKE',
    zones: ['Anna Nagar', 'T. Nagar', 'Porur'],
    currentZone: 'Anna Nagar',
    capacity: 12,
    maxConcurrentJobs: 3,
  },
  {
    name: 'Rahul Verma',
    vehicle: 'VAN',
    zones: ['T. Nagar', 'Adyar', 'Sholinganallur', 'Guindy'],
    currentZone: 'Adyar',
    capacity: 60,
    maxConcurrentJobs: 5,
  },
  {
    name: 'Sneha Kulkarni',
    vehicle: 'SCOOTER',
    zones: ['Porur', 'Anna Nagar', 'Ambattur'],
    currentZone: 'Porur',
    capacity: 20,
    maxConcurrentJobs: 4,
  },
  {
    name: 'Imran Sheikh',
    vehicle: 'BIKE',
    zones: ['Guindy', 'T. Nagar', 'Adyar'],
    currentZone: 'Guindy',
    capacity: 10,
    maxConcurrentJobs: 3,
    availability: 'ON_BREAK',
  },
  {
    name: 'Divya Rao',
    vehicle: 'VAN',
    zones: ['Ambattur', 'Anna Nagar', 'T. Nagar', 'Porur'],
    currentZone: 'Ambattur',
    capacity: 50,
    maxConcurrentJobs: 4,
  },
  {
    name: 'Karthik Iyer',
    vehicle: 'SCOOTER',
    zones: ['Sholinganallur', 'Adyar'],
    currentZone: 'Sholinganallur',
    capacity: 20,
    maxConcurrentJobs: 4,
    availability: 'OFFLINE',
  },
  {
    name: 'Meera Joshi',
    vehicle: 'BIKE',
    zones: ['T. Nagar', 'Anna Nagar', 'Adyar'],
    currentZone: 'Adyar',
    capacity: 8,
    maxConcurrentJobs: 2,
  },
] satisfies CreateRiderInput[];

const JOBS = {
  J1: {
    orderId: 'RLY-1001',
    pickupZone: 'T. Nagar',
    deliveryZone: 'Anna Nagar',
    load: 4,
    priority: 'NORMAL',
    customerName: 'Bloom Florist',
  },
  J2: {
    orderId: 'RLY-1002',
    pickupZone: 'Adyar',
    deliveryZone: 'Guindy',
    load: 2,
    priority: 'LOW',
    customerName: 'Paper & Pine',
  },
  J3: {
    orderId: 'RLY-1003',
    pickupZone: 'Anna Nagar',
    deliveryZone: 'Porur',
    load: 6,
    priority: 'HIGH',
    customerName: 'Urban Pharmacy',
    notes: 'Cold chain - keep upright',
  },
  J4: {
    orderId: 'RLY-1004',
    pickupZone: 'T. Nagar',
    deliveryZone: 'Adyar',
    load: 3,
    priority: 'NORMAL',
    customerName: 'Spice Route Kitchen',
  },
  J5: {
    orderId: 'RLY-1005',
    pickupZone: 'T. Nagar',
    deliveryZone: 'Guindy',
    load: 5,
    priority: 'NORMAL',
    customerName: 'Tech Hub Supplies',
  },
  J6: {
    orderId: 'RLY-1006',
    pickupZone: 'Anna Nagar',
    deliveryZone: 'T. Nagar',
    load: 8,
    priority: 'NORMAL',
    customerName: 'Fresh Basket',
  },
  J7: {
    orderId: 'RLY-1007',
    pickupZone: 'T. Nagar',
    deliveryZone: 'Anna Nagar',
    load: 3,
    priority: 'HIGH',
    customerName: 'MedPlus',
  },
  J8: {
    orderId: 'RLY-1008',
    pickupZone: 'Adyar',
    deliveryZone: 'T. Nagar',
    load: 4,
    priority: 'NORMAL',
    customerName: 'Loom & Co.',
  },
  J9: {
    orderId: 'RLY-1009',
    pickupZone: 'Porur',
    deliveryZone: 'Anna Nagar',
    load: 5,
    priority: 'NORMAL',
    customerName: 'Gadget Garage',
  },
  J10: {
    orderId: 'RLY-1010',
    pickupZone: 'Guindy',
    deliveryZone: 'Adyar',
    load: 2,
    priority: 'LOW',
    customerName: 'Book Nook',
  },
  J11: {
    orderId: 'RLY-1011',
    pickupZone: 'T. Nagar',
    deliveryZone: 'Porur',
    load: 3,
    priority: 'URGENT',
    customerName: 'City Hospital Labs',
    deadlineIn: 55,
  },
  J12: {
    orderId: 'RLY-1012',
    pickupZone: 'Sholinganallur',
    deliveryZone: 'Porur',
    load: 5,
    priority: 'HIGH',
    customerName: 'Chipworks',
    notes: 'No active rider covers this lane',
  },
  J13: {
    orderId: 'RLY-1013',
    pickupZone: 'Ambattur',
    deliveryZone: 'T. Nagar',
    load: 45,
    priority: 'NORMAL',
    customerName: 'Home Interiors',
    notes: 'Bulky - van required',
  },
} satisfies Record<string, Omit<CreateJobInput, 'deadline'> & { deadlineIn?: number }>;

type JobKey = keyof typeof JOBS;

export async function clearAllData() {
  await Promise.all([
    Job.deleteMany({}),
    Rider.deleteMany({}),
    Assignment.deleteMany({}),
    JobEvent.deleteMany({}),
  ]);
  settings.reset();
  clock.reset();
}
export async function seedDemoData({ reset = false }: { reset?: boolean } = {}) {
  if (reset) {
    await Promise.all([
      Job.deleteMany({}),
      Rider.deleteMany({}),
      Assignment.deleteMany({}),
      JobEvent.deleteMany({}),
    ]);
  }
  settings.reset();
  clock.reset();
  const base = Date.now();
  const ago = (minutes: number) => clock.travelTo(new Date(base - minutes * 60_000));
  const asha = dispatcherActor('Asha Menon');
  const ravi = dispatcherActor('Ravi Kapoor');
  const jobs = {} as Record<JobKey, string>;
  const riders = {} as Record<JobKey, string>;
  const open = async (key: JobKey) => {
    const { deadlineIn, ...fields } = JOBS[key] as (typeof JOBS)[JobKey] & { deadlineIn?: number };
    const { job } = await createJob(
      { ...fields, deadline: deadlineIn ? new Date(base + deadlineIn * 60_000) : undefined },
      asha,
    );
    jobs[key] = String(job._id);
  };
  const assignRank = async (key: JobKey, actor: Actor, n = 0, overrideReason?: string) => {
    const job = (await Job.findById(jobs[key]))!;
    const rec = await recommendForJob(job);
    const pick = rec.candidates[n];
    const { assignment } = await assignments.assign({
      jobId: jobs[key],
      riderId: pick.riderId,
      actor,
      overrideReason,
    });
    riders[key] = pick.riderId;
    return assignment;
  };
  const asRider = async (key: JobKey) => {
    const rider = (await Rider.findById(riders[key]))!;
    return riderActor({ id: String(rider._id), name: rider.name });
  };
  const currentAssignmentId = async (key: JobKey) =>
    (await Job.findById(jobs[key]))!.currentAssignmentId!;
  const accept = async (key: JobKey) =>
    assignments.accept({ assignmentId: await currentAssignmentId(key), actor: await asRider(key) });
  const steps: Array<[number, () => Promise<unknown>]> = [
    [
      480,
      async () => {
        for (const r of RIDERS) await createRider(r);
      },
    ],

    [360, () => open('J1')],
    [358, () => assignRank('J1', asha)],
    [352, async () => accept('J1')],
    [340, async () => delivery.pickUp({ jobId: jobs.J1, actor: await asRider('J1') })],
    [315, async () => delivery.deliver({ jobId: jobs.J1, actor: await asRider('J1') })],
    [330, () => open('J2')],
    [
      322,
      () =>
        delivery.cancel({ jobId: jobs.J2, actor: ravi, reason: 'Customer cancelled the order' }),
    ],

    [300, () => open('J3')],
    [296, () => assignRank('J3', asha)],
    [170, () => processExpired()],
    [240, () => open('J4')],
    [236, () => assignRank('J4', ravi)],
    [
      228,
      async () =>
        assignments.reject({
          assignmentId: await currentAssignmentId('J4'),
          actor: await asRider('J4'),
          reason: 'Scooter puncture - cannot ride',
        }),
    ],
    [200, () => open('J5')],
    [198, () => assignRank('J5', asha)],
    [
      188,
      async () => {
        const job = (await Job.findById(jobs.J5))!;
        const rec = await recommendForJob(job);
        const next = rec.candidates.find((c) => c.riderId !== riders.J5)!;
        await assignments.reassign({
          jobId: jobs.J5,
          riderId: next.riderId,
          actor: asha,
          reason: 'First rider is stuck behind an accident on Outer Ring Road',
        });
        riders.J5 = next.riderId;
      },
    ],
    [184, async () => accept('J5')],
    [170, async () => delivery.pickUp({ jobId: jobs.J5, actor: await asRider('J5') })],
    [140, async () => delivery.deliver({ jobId: jobs.J5, actor: await asRider('J5') })],
    [90, () => open('J6')],
    [88, () => assignRank('J6', asha)],
    [84, async () => accept('J6')],
    [55, async () => delivery.pickUp({ jobId: jobs.J6, actor: await asRider('J6') })],
    [50, () => open('J7')],
    [48, () => assignRank('J7', ravi)],
    [44, async () => accept('J7')],
    [105, () => open('J8')],
    [105, () => assignRank('J8', asha)],

    [12, () => open('J9')],
    [10, () => assignRank('J9', ravi)],

    [25, () => open('J10')],
    [8, () => open('J11')],
    [20, () => open('J12')],
    [19, () => evaluateReadyJob(jobs.J12)],
    [5, () => open('J13')],
  ];
  steps.sort((a, b) => b[0] - a[0]);
  for (const [minutesAgo, run] of steps) {
    ago(minutesAgo);
    await run();
  }
  clock.reset();
  return { jobs: Object.keys(jobs).length, riders: RIDERS.length };
}
