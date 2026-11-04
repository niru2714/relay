# Engineering notes

## Assumptions
* A **job is complete at intake** (all required fields validated), so `NEW → READY_FOR_ASSIGNMENT` is automatic in the same request; both steps are audited.
* **`orderId` is the client’s idempotency key.** Same reference + same details = harmless retry; same reference + different details = conflict.
* **One open assignment per job, one rider per assignment.** Multi-rider relays are out of scope.
* **Capacity is a single scalar** (“units”). A rider can carry several jobs up to `capacity` and `maxConcurrentJobs`. Pending (unconfirmed) assignments *reserve* capacity - otherwise a rider could be promised work twice.
* **Rejection → Manual Queue** (same as a timeout); the rejecting rider is excluded for that job. A rider who merely *timed out* is penalised but not excluded.
* **Geography is simulated:** seven named zones on a km grid; travel minutes derive from distance. A rider’s “current zone” moves to the pickup/delivery zone as they work.
* **“Deliveries in progress”** on the dashboard = `ACCEPTED + PICKED_UP` (broken down on the card).
* **No auth:** identity is declared via `X-Actor-*` headers and recorded in the audit trail; a rider-role actor is restricted to their own work.
* Timeout is measured from assignment creation to `expiresAt`, using a **simulated clock** that defaults to real time.

## Known limitations
* **No multi-document transactions.** Correctness comes from single-document compare-and-set + ordered steps + a repair sweep (see SYSTEM_DESIGN §5). The remaining window - a crash between a state change and its audit event - can lose an event. Fix: transactions or an outbox.
* **Per-process runtime state:** the simulated clock and the runtime-edited settings live in the API process. Several instances would each have their own. (The data-changing logic itself is multi-instance safe.)
* **In-memory database by default** → data resets on restart (use `MONGODB_URI` to persist).
* **`attention` is derived at read time** over ≤500–1000 open jobs. Fine for a small desk; needs materialising at scale.
* **Recommendation reads all riders** per request. Fine for tens/hundreds.
* **No pagination on `/manual-queue` or `/riders`**; **polling** (4 s) rather than push.
* **No cancel after pickup / failed-delivery / return flow.** `PICKED_UP` can only go to `DELIVERED`.
* A rider’s `capacity`/`maxConcurrentJobs` cannot be lowered below what they carry (by design), and going `OFFLINE` does not unassign work already accepted.
* The UI is desktop-first (responsive down to tablet/phone, not tuned for one-handed rider use). No automated browser tests.

## Not finished / deliberately left out
* Real rider-side experience (the confirm/reject/pickup/deliver buttons are the simulation).
* Notifications (SMS/push) to riders and customers.
* Role-based UI and login.
* Reporting (SLA, time-to-assign, timeout rate per rider) - the data model supports it (`{type, at}` index on events).

## What I would do next (top three)
1. **Make state + audit atomic and scale the timeout** - run on a replica set with transactions (or an outbox), move the sweeper onto a lease/queue with delayed jobs, and put the clock/settings in the database. This removes the last consistency gap and makes horizontal scaling a non-event.
2. **Smarter, learned dispatch** - add real zone geometry/ETA, rider acceptance-rate and on-time history as ranking features, batch/“wave” assignment across several waiting jobs (not job-by-job), and an offline evaluation harness replaying historical jobs to compare weight sets before shipping them.
3. **Real-time + rider channel + auth** - SSE/WebSocket push instead of polling, a rider app/notification flow for confirmations with an escalating reminder before the timeout, and JWT-based roles (dispatcher / rider / admin) replacing the demo headers.

## Process notes
* Built domain-first: the state machine and ranking were written and tested as pure functions before any endpoint existed.
* The concurrency tests were written *before* trusting the design - and they found real defects early (e.g. Mongoose silently treating a `type` field in a nested object as the schema type, and an id transform stamping `"undefined"` onto sub-documents).
* Everything is TypeScript with `strict`; `npm run typecheck` is clean for both server and client.
