import { Assignment, Rider, Job } from '../models/index.js';
import { ASSIGNMENT_STATUS as A, JOB_STATUS as S } from '../domain/constants.js';
import { clock } from '../lib/clock.js';

export async function expectedLedger() {
  const rows = await Assignment.aggregate([
    { $match: { active: true } },
    {
      $group: {
        _id: { riderId: '$riderId', status: '$status' },
        load: { $sum: '$load' },
        jobs: { $sum: 1 },
      },
    },
  ]);
  const byRider = new Map<
    string,
    { reservedLoad: number; pendingJobs: number; activeLoad: number; activeJobs: number }
  >();
  for (const row of rows) {
    const key = String(row._id.riderId);
    const entry = byRider.get(key) ?? {
      reservedLoad: 0,
      pendingJobs: 0,
      activeLoad: 0,
      activeJobs: 0,
    };
    if (row._id.status === A.PENDING)
      Object.assign(entry, { reservedLoad: row.load, pendingJobs: row.jobs });
    if (row._id.status === A.ACCEPTED)
      Object.assign(entry, { activeLoad: row.load, activeJobs: row.jobs });
    byRider.set(key, entry);
  }
  return byRider;
}
export async function check() {
  const [expected, riders, duplicates, openJobs] = await Promise.all([
    expectedLedger(),
    Rider.find(),
    Assignment.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$jobId', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]),
    Job.find({ status: { $in: [S.AWAITING_CONFIRMATION, S.ACCEPTED, S.PICKED_UP] } }).select(
      'status currentAssignmentId assignedRiderId',
    ),
  ]);
  const ledgerDrift = [];
  for (const rider of riders) {
    const want = expected.get(String(rider._id)) ?? {
      reservedLoad: 0,
      pendingJobs: 0,
      activeLoad: 0,
      activeJobs: 0,
    };
    const diff: Record<string, { stored: number; expected: number }> = {};
    for (const key of Object.keys(want) as (keyof typeof want)[])
      if (rider[key] !== want[key]) diff[key] = { stored: rider[key], expected: want[key] };
    if (Object.keys(diff).length)
      ledgerDrift.push({ riderId: String(rider._id), name: rider.name, diff });
  }
  const openIds = openJobs.map((j) => j.currentAssignmentId).filter(Boolean);
  const attempts = await Assignment.find({ _id: { $in: openIds } }).select(
    'status riderId jobId active',
  );
  const byId = new Map(attempts.map((a) => [String(a._id), a]));
  const brokenLinks = [];
  for (const job of openJobs) {
    const a = byId.get(String(job.currentAssignmentId));
    const okStatus =
      job.status === S.AWAITING_CONFIRMATION ? a?.status === A.PENDING : a?.status === A.ACCEPTED;
    if (!a || !okStatus || !a.active || String(a.riderId) !== String(job.assignedRiderId)) {
      brokenLinks.push({
        jobId: String(job._id),
        jobStatus: job.status,
        assignmentStatus: a?.status ?? null,
      });
    }
  }
  const ok = !ledgerDrift.length && !duplicates.length && !brokenLinks.length;
  return {
    ok,
    checkedAt: clock.now(),
    ledgerDrift,
    jobsWithMultipleOpenAssignments: duplicates.map((d) => String(d._id)),
    brokenLinks,
  };
}
export async function repairLedger() {
  const expected = await expectedLedger();
  const riders = await Rider.find().select('_id');
  await Promise.all(
    riders.map((r) =>
      Rider.updateOne(
        { _id: r._id },
        {
          $set: {
            reservedLoad: 0,
            pendingJobs: 0,
            activeLoad: 0,
            activeJobs: 0,
            ...(expected.get(String(r._id)) ?? {}),
            updatedAt: clock.now(),
          },
        },
      ),
    ),
  );
  return check();
}
