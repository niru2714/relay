# RELAY API reference

Base URL `http://localhost:5001/api` (the UI proxies `/api` from `:5173`). JSON in, JSON out.

## Conventions

**Envelope.** Success → `{ "data": …, "meta"?: … }`. Lists add `meta: { page, limit, total }`.
Errors → `{ "error": { "code", "message", "details"?, "requestId" } }` (every response also carries `X-Request-Id`).

**Identity (no auth in this exercise).** Say who is acting; it is stored on every audit event.

| Header | Values | Default |
|---|---|---|
| `X-Actor-Role` | `DISPATCHER` · `RIDER` · `SYSTEM` | `DISPATCHER` |
| `X-Actor-Name` | display name | `Demo Dispatcher` |
| `X-Actor-Id` | for `RIDER`: **the rider’s id** | derived from name |

A `RIDER` actor may only act on *their own* assignment/delivery (`403 NOT_ASSIGNED_RIDER` otherwise).

**Idempotency.** Retrying any write is safe. Create-job dedupes on `orderId`; assign/accept/pickup/deliver/cancel/reject return the
existing result with `200` and `meta.idempotentReplay: true` instead of acting twice.

**Status codes.** `200/201` ok · `400` invalid input · `403` wrong actor · `404` missing · `409` conflicts with current state ·
`422` well-formed but not allowed by a business rule · `500` unexpected.

## Job lifecycle

```
NEW → READY_FOR_ASSIGNMENT → AWAITING_CONFIRMATION → ACCEPTED → PICKED_UP → DELIVERED
                │  ▲                │  ▲                  │
                ▼  │                ▼  │                  ▼
              MANUAL_QUEUE ◀── timeout / rejection / withdrawal           any pre-pickup state → CANCELLED
```
Illegal moves (e.g. `DELIVERED` before `PICKED_UP`, anything after `CANCELLED`) return `409 INVALID_TRANSITION`
with `details: { from, to, allowed[] }`.

---

## Delivery jobs

### `POST /jobs` - create (idempotent)
```json
{ "orderId": "ORD-1042", "pickupZone": "T. Nagar", "deliveryZone": "Anna Nagar",
  "load": 6, "priority": "HIGH", "deadline": "2026-11-03T18:30:00Z",
  "customerName": "Bloom Florist", "notes": "Fragile" }
```
`priority`: `LOW|NORMAL|HIGH|URGENT` (default `NORMAL`) · `deadline`, `customerName`, `notes` optional · unknown fields are rejected.
Zones come from `GET /meta`.

* `201` created → job (status `READY_FOR_ASSIGNMENT`), `meta.dispatch` tells whether auto-dispatch ran.
* `200` + `meta.duplicate: true` - same `orderId` **and** same details: returns the original job.
* `409 DUPLICATE_ORDER_CONFLICT` - same `orderId`, different details.
* `422 DEADLINE_IN_PAST` · `400 VALIDATION_ERROR` (`details: [{field, message}]`).

### `GET /jobs` - list / search / filter
Query: `q` (order-id contains, case-insensitive) · `status` (comma list, e.g. `ACCEPTED,PICKED_UP`) · `zone` (pickup *or* delivery) ·
`pickupZone` · `deliveryZone` · `priority` · `riderId` · `attention=true` (only jobs needing a human) ·
`sort=newest|oldest|priority|deadline` · `page` · `limit` (≤100, default 25).

Each job:
```json
{ "id": "…", "orderId": "RLY-1009", "pickupZone": "Porur", "deliveryZone": "Anna Nagar", "load": 5,
  "priority": "NORMAL", "deadline": null, "status": "AWAITING_CONFIRMATION",
  "assignedRider": { "id": "…", "name": "Sneha Kulkarni" }, "assignmentExpiresAt": "2026-11-03T16:42:15.879Z",
  "attemptCount": 1, "createdAt": "…", "updatedAt": "…",
  "attention": [ { "code": "CONFIRMATION_EXPIRING", "severity": "warning", "message": "Rider confirmation expires in 7 min" } ] }
```
`attention` is derived on read: `IN_MANUAL_QUEUE`, `NO_ELIGIBLE_RIDER`, `UNASSIGNED_TOO_LONG`, `CONFIRMATION_EXPIRING`, `DEADLINE_AT_RISK`, `DEADLINE_MISSED`.

### `GET /jobs/:id`
The job plus `currentAssignment` (the open attempt) · `manualQueue { reason, detail, enteredAt }` when queued · `cancellation { reason, at, by }` when cancelled.

### `GET /jobs/:id/events` - operational history
Chronological audit trail (insertion order). Each event:
```json
{ "id": "…", "type": "RIDER_ASSIGNED", "at": "…", "actor": { "type": "DISPATCHER", "id": "ravi-kapoor", "name": "Ravi Kapoor" },
  "fromStatus": "READY_FOR_ASSIGNMENT", "toStatus": "AWAITING_CONFIRMATION", "riderId": "…", "assignmentId": "…",
  "message": "Assigned to Sneha Kulkarni (recommendation #1, score 88.6)",
  "details": { "rank": 1, "score": 88.6, "explanation": "…", "capacityReserved": 5, "expiresAt": "…", "confirmationWindowMinutes": 120 } }
```
Types: `JOB_CREATED` `JOB_READY` `NO_ELIGIBLE_RIDER` `RIDER_ASSIGNED` `MANUAL_OVERRIDE` `RIDER_REASSIGNED` `ASSIGNMENT_ACCEPTED`
`ASSIGNMENT_REJECTED` `ASSIGNMENT_EXPIRED` `ASSIGNMENT_WITHDRAWN` `MOVED_TO_MANUAL_QUEUE` `REQUEUED` `PICKED_UP` `DELIVERED` `JOB_CANCELLED`.

### `GET /jobs/:id/assignments`
Every attempt (never deleted): `attemptNo`, `riderId/riderName`, `status` (`PENDING|ACCEPTED|REJECTED|EXPIRED|WITHDRAWN|REASSIGNED|CANCELLED|COMPLETED`),
`source` (`RECOMMENDED|OVERRIDE|AUTO|REASSIGNMENT`), `overrideReason`, `recommendation { rank, score, topRiderName, … }`, `assignedAt`, `expiresAt`, `closedAt`, `closeReason`.

---

## Recommendations & assignment

### `GET /jobs/:id/recommendations` - read-only
```json
{ "data": {
  "weights": { "travel": 0.35, "workload": 0.3, "fit": 0.1, "deadline": 0.25 },
  "topRiderId": "…", "hasEligibleRider": true,
  "candidates": [ {
    "rank": 1, "riderId": "…", "riderName": "Arjun Mehta", "score": 81.1, "etaMinutes": 34,
    "breakdown": { "travel": { "value": 0.9, "weight": 0.35, "points": 31.1 }, "workload": {…}, "fit": {…}, "deadline": {…} },
    "reasons": ["5 min from pickup (Guindy → Guindy), ETA 34 min", "1 of 4 job slots in use", "17 of 20 capacity units free (needs 2)"],
    "warnings": [], "explanation": "Recommended over Rahul Verma: 9.4 pts higher, mainly closer to pickup" } ],
  "ineligible": [ { "riderId": "…", "riderName": "Priya Nair",
    "reasons": [ { "code": "PICKUP_ZONE_NOT_SERVED", "message": "Does not serve pickup zone Guindy" } ] } ] } }
```
Ineligibility codes: `UNAVAILABLE` `PICKUP_ZONE_NOT_SERVED` `DELIVERY_ZONE_NOT_SERVED` `INSUFFICIENT_CAPACITY` `NO_FREE_SLOT` `PREVIOUSLY_REJECTED`.
An empty `candidates` array is a normal answer (“no eligible rider”). The ranking algorithm is documented in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md#recommendation-engine).

### `POST /jobs/:id/assign` - job in `READY_FOR_ASSIGNMENT` or `MANUAL_QUEUE`
```json
{ "riderId": "…", "overrideReason": "Customer asked for this rider" }
```
`overrideReason` is **required (422 `OVERRIDE_REASON_REQUIRED`) when the rider is not the #1 recommendation**, and is recorded (assignment `source: "OVERRIDE"` + a `MANUAL_OVERRIDE` event).
Result `201`: `{ data: { job, assignment } }` - status `AWAITING_CONFIRMATION`, capacity **reserved**, `expiresAt = now + timeout`.

| Status | Code | When |
|---|---|---|
| 200 | `meta.idempotentReplay` | same rider already holds this job (a retry) |
| 404 | `NOT_FOUND` | unknown job / rider |
| 409 | `INVALID_TRANSITION` | job already has a rider (use reassign) / cancelled / delivered … |
| 409 | `JOB_STATE_CHANGED` | another dispatcher/process acted first - refresh |
| 409 | `RIDER_CAPACITY_CHANGED` | the rider filled up between recommendation and assignment |
| 422 | `RIDER_NOT_ELIGIBLE` | `details.reasons[]` explain why |
| 422 | `OVERRIDE_REASON_REQUIRED` | `details.recommended` names the top pick |

### `POST /jobs/:id/reassign` - job in `AWAITING_CONFIRMATION` or `ACCEPTED`
```json
{ "riderId": "…", "reason": "First rider stuck in traffic", "expectedAssignmentId": "…" }
```
`reason` required. `expectedAssignmentId` (optional, the UI always sends it) makes a stale screen fail with `409 STALE_ASSIGNMENT` instead of silently replacing someone else’s decision. `409 SAME_RIDER` if unchanged.
The old attempt is kept as `REASSIGNED` and its capacity released; the new rider’s capacity is reserved first, so a failure changes nothing.

### `POST /jobs/:id/auto-assign`
Assigns the top-ranked rider as the calling actor. `200 { meta: { assigned: false, reason: "NO_ELIGIBLE_RIDER" } }` if nobody qualifies
(the job stays `READY_FOR_ASSIGNMENT`, is flagged, and an event is recorded once).

---

## Rider confirmation

All idempotent. The assigned rider’s id must match `X-Actor-Id` when `X-Actor-Role: RIDER`.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /assignments/:id/accept` | – | `PENDING→ACCEPTED`, reserved → active capacity, job `ACCEPTED`. `409 ASSIGNMENT_EXPIRED` if the window passed (the job is moved to the queue on the spot). |
| `POST /assignments/:id/reject` | `{ reason? }` | `PENDING→REJECTED`, capacity released, job → `MANUAL_QUEUE` (`RIDER_REJECTED`). Rider excluded from this job’s future recommendations. |
| `POST /assignments/:id/withdraw` | `{ reason? }` | `ACCEPTED→WITHDRAWN` (before pickup), capacity released, job → `MANUAL_QUEUE` (`RIDER_WITHDREW`). |

## Delivery updates

| Endpoint | Body | Allowed from | Result |
|---|---|---|---|
| `POST /jobs/:id/pickup` | – | `ACCEPTED` | `PICKED_UP` (rider’s location → pickup zone) |
| `POST /jobs/:id/deliver` | – | `PICKED_UP` | `DELIVERED`, attempt `COMPLETED`, active capacity released, rider location → delivery zone |
| `POST /jobs/:id/cancel` | `{ reason }` (required) | any state before pickup | `CANCELLED`, open attempt closed, capacity released |

Anything else → `409 INVALID_TRANSITION` with a hint (e.g. *“The delivery has not been picked up yet.”*, *“in transit and cannot be cancelled”*).

## Manual queue

| Endpoint | Description |
|---|---|
| `GET /manual-queue` | Queued jobs, most urgent then longest-waiting first, with `manualQueue.reason`, `failedAttempts`, `attention`. |
| `GET /manual-queue/:jobId` | **Investigate** in one call: `{ job, events, assignments, recommendation }`. |
| `POST /jobs/:id/assign` | Assign a rider straight out of the queue (see above). |
| `POST /jobs/:id/requeue` `{ note? }` | Hand it back to the auto-dispatch pool (`READY_FOR_ASSIGNMENT`). |
| `POST /jobs/:id/escalate` `{ reason }` | Send an unassigned job to the queue deliberately. |

Queue reasons: `ASSIGNMENT_TIMEOUT` · `RIDER_REJECTED` · `RIDER_WITHDREW` · `DISPATCHER_ESCALATION` · `ORPHANED_ASSIGNMENT`.

## Riders

| Endpoint | Description |
|---|---|
| `GET /riders?availability=&zone=` | Riders with ledger + derived `availableCapacity`, `openSlots`, `utilization`, `canTakeAnotherDelivery`. |
| `GET /riders/:id` | Rider + `activeAssignments[]` (with their jobs). |
| `POST /riders` | `{ name, vehicle?, zones[], capacity, maxConcurrentJobs, availability?, currentZone? }` |
| `PATCH /riders/:id` | Any of `name, phone, vehicle, zones, currentZone, availability, capacity, maxConcurrentJobs`. `409 CAPACITY_BELOW_COMMITTED` if it would drop below what they carry (checked atomically). |
| `GET /riders/:id/fit?pickupZone=&deliveryZone=&load=` | **“Can this rider take another delivery?”** → `{ canTake, reasons[], availableCapacity, openSlots }` using the same rules as the recommender. |

Rider ledger fields: `reservedLoad/pendingJobs` (held for unconfirmed assignments) · `activeLoad/activeJobs` (accepted … delivered).

## Dashboard & metadata

`GET /dashboard` → `totals { received, awaitingAssignment, awaitingConfirmation, inProgress, manualQueue, completed, cancelled }`,
`byStatus`, `inProgressBreakdown`, `attention { total, critical, items[] }`, `riders { total, available, onBreak, offline, capacityUtilization }`, `config`.
`GET /meta` → zones, travel-time matrix, statuses, allowed transitions, ranking weights, config.
`GET /health` → `{ status, db, uptimeSeconds }`.

## Timeout, clock & demo controls (`/system`)

| Endpoint | Description |
|---|---|
| `GET /system/config` | `{ assignmentTimeoutMinutes, autoDispatch, now, simulatedClock, clockOffsetMinutes }` |
| `PUT /system/config` | `{ assignmentTimeoutMinutes?: 0.05–1440, autoDispatch?: boolean }` - applies to assignments created afterwards |
| `POST /system/clock/advance` | `{ minutes }` - move the **simulated clock** forward |
| `POST /system/clock/reset` | back to real time |
| `POST /system/sweep` | run maintenance now: expire overdue assignments → repair orphans → dispatch pool |
| `GET /system/integrity` | proves the capacity ledger equals what the assignments imply → `{ ok, ledgerDrift[], … }` |
| `POST /system/integrity/repair` | rewrite the ledger from assignments (run when quiet) |
| `POST /system/reset-demo` | wipe and reload demo data |

Mutating `/system` endpoints return `403 DEMO_ENDPOINTS_DISABLED` when `ENABLE_DEMO_ENDPOINTS=false`.

## Error codes

`VALIDATION_ERROR` · `INVALID_JSON` · `NOT_FOUND` · `ROUTE_NOT_FOUND` · `NOT_ASSIGNED_RIDER` (403) · `INVALID_TRANSITION` · `JOB_STATE_CHANGED` ·
`DUPLICATE_ORDER_CONFLICT` · `STALE_ASSIGNMENT` · `SAME_RIDER` · `RIDER_CAPACITY_CHANGED` · `ASSIGNMENT_NOT_PENDING` · `ASSIGNMENT_EXPIRED` ·
`ASSIGNMENT_NOT_ACCEPTED` · `CAPACITY_BELOW_COMMITTED` · `RIDER_NOT_ELIGIBLE` · `OVERRIDE_REASON_REQUIRED` · `DEADLINE_IN_PAST` · `DEMO_ENDPOINTS_DISABLED` · `INTERNAL_ERROR`.

Validation error example (`400`):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The request is invalid", "requestId": "a1b2c3d4",
  "details": [ { "field": "pickupZone", "message": "Must be one of: T. Nagar, Anna Nagar, …" }, { "field": "load", "message": "Number must be greater than or equal to 1" } ] } }
```

## Walkthrough with curl

```bash
API=http://localhost:5001/api
# 1. shorten the window so the timeout is quick to see (30 seconds)
curl -sX PUT $API/system/config -H 'content-type: application/json' -d '{"assignmentTimeoutMinutes":0.5}'
# 2. create a job (run it twice - the second call returns the same job with meta.duplicate=true)
curl -sX POST $API/jobs -H 'content-type: application/json' \
  -d '{"orderId":"DEMO-1","pickupZone":"T. Nagar","deliveryZone":"Anna Nagar","load":6,"priority":"HIGH"}'
JOB=<id from response>
# 3. look at the ranking, then assign the top pick
curl -s $API/jobs/$JOB/recommendations | jq '.data.candidates[] | {rank, riderName, score, explanation}'
curl -sX POST $API/jobs/$JOB/assign -H 'content-type: application/json' -d '{"riderId":"<top riderId>"}'
# 4. do nothing for 30s (or move time) → the sweeper moves it to the manual queue
curl -sX POST $API/system/clock/advance -H 'content-type: application/json' -d '{"minutes":1}'
curl -sX POST $API/system/sweep
curl -s $API/manual-queue | jq '.data[] | {orderId, status, reason: .manualQueue.reason}'
# 5. reassign from the queue, rider confirms, deliver
curl -sX POST $API/jobs/$JOB/assign -H 'content-type: application/json' -d '{"riderId":"<another riderId>","overrideReason":"Original rider unresponsive"}'
curl -sX POST $API/assignments/<assignmentId>/accept -H 'X-Actor-Role: RIDER' -H 'X-Actor-Id: <riderId>'
curl -sX POST $API/jobs/$JOB/pickup  -H 'X-Actor-Role: RIDER' -H 'X-Actor-Id: <riderId>'
curl -sX POST $API/jobs/$JOB/deliver -H 'X-Actor-Role: RIDER' -H 'X-Actor-Id: <riderId>'
curl -s $API/jobs/$JOB/events | jq '.data[] | {type, at, by: .actor.name, message}'
```
