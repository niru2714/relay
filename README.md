# RELAY - the autonomous dispatch desk

A MERN + TypeScript application that helps an operations team take delivery jobs from intake to delivery:
it **recommends riders**, lets dispatchers **assign or override**, tracks **rider confirmation**, automatically
moves unanswered jobs into a **Manual Queue**, and keeps a complete **audit trail** of everything that happens.

|              |                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | React 18 · TypeScript · Vite · **Tailwind CSS v4** (light theme) · TanStack Query · React Router · **`motion`** (`motion/react`) animations |
| **Backend**  | Node 20+ · Express · TypeScript · Mongoose · Zod                                                                                            |
| **Database** | MongoDB (in-memory by default - nothing to install)                                                                                         |
| **Tests**    | Vitest + Supertest, real MongoDB (95 tests)                                                                                                 |

Documents: [API reference](docs/API.md) · [System design](docs/SYSTEM_DESIGN.md) · [Engineering notes](docs/ENGINEERING_NOTES.md) · [One-page presentation (PDF)](docs/RELAY-one-pager.pdf)

---

## Run it locally (3 steps)

**You need:** Node.js 20 or newer and npm. You do **not** need to install MongoDB.

```bash
git clone <repo-url> relay && cd relay
npm install
npm run dev
```

Then open **http://localhost:5173**.

- The API runs on port 5001 and the web app on 5173. Both start from the one `npm run dev` command.
- The first start downloads a small MongoDB binary (about 70 MB) for the built-in in-memory database, so it needs internet once.
- The app starts **empty**. To get sample riders and jobs with history, either click **Load demo data** in the _Demo controls_ card on the Dashboard, or start the API with `SEED_ON_START=true npm run dev`.
- Data lives in memory and is reset every time the server restarts.

**Something not working?**

| Problem                                 | Fix                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `EADDRINUSE` on 5001 or 5173            | Another app uses the port. Stop it, or set `PORT=5002` in `server/.env` and `VITE_API_URL=http://localhost:5002` when starting the client. |
| Page loads but shows an API error       | The API is not running. Run `npm run dev` from the project root (not from `client/`).                                                      |
| First start hangs on "starting MongoDB" | It is downloading the MongoDB binary. Wait, or use a real MongoDB (see below).                                                             |
| Node version error                      | Check `node -v`. Version 20 or newer is required.                                                                                          |

### Commands

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | API (with reload) and web app together                         |
| `npm test`          | All 95 server tests (unit and integration)                     |
| `npm run typecheck` | TypeScript check for server and client                         |
| `npm run lint`      | ESLint for the whole repo                                      |
| `npm run format`    | Prettier. `npm run format:check` only verifies                 |
| `npm run build`     | Type-check and production build of the web app (`client/dist`) |
| `npm run start`     | API only, no reload                                            |
| `npm run seed`      | Wipe and reseed the database named by `MONGODB_URI`            |

### Configuration (all optional)

Copy [`server/.env.example`](server/.env.example) to `server/.env` to change any of these.

| Variable                     | Default                    | Meaning                                                              |
| ---------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `PORT`                       | `5001`                     | API port                                                             |
| `MONGODB_URI`                | empty (in-memory database) | Connection string for a real MongoDB or Atlas                        |
| `SEED_ON_START`              | `false`                    | `true` loads demo data when the database is empty                    |
| `ASSIGNMENT_TIMEOUT_MINUTES` | `120`                      | How long a rider has to confirm. Fractions work (`0.5` = 30 seconds) |
| `AUTO_DISPATCH`              | `false`                    | Auto-assign the top-ranked rider when a job becomes ready            |
| `SWEEP_INTERVAL_MS`          | `5000`                     | How often the background job looks for expired confirmations         |
| `ENABLE_DEMO_ENDPOINTS`      | `true` outside production  | Simulated clock, sweep-now, load and clear demo data                 |
| `CORS_ORIGIN`                | `http://localhost:5173`    | Browser origin(s) allowed to call the API (comma separated)          |

### Use a real MongoDB instead

```bash
docker compose up -d
echo "MONGODB_URI=mongodb://127.0.0.1:27017/relay" > server/.env
npm run dev
```

---

## Deploy it (free)

The web app is static, so it can go on **Vercel** or **Netlify**. The API is a long-running Node process (it has a background timer for confirmation timeouts), so it cannot run as a serverless function. Host it on **Render** (free) with a free **MongoDB Atlas** database.

**1. Database.** Create a free cluster on MongoDB Atlas, add a database user, allow access from anywhere (`0.0.0.0/0`), and copy the connection string.

**2. API on Render.** New + Blueprint, pick this repository (it reads [`render.yaml`](render.yaml)). Set `MONGODB_URI` to the Atlas string. Leave `CORS_ORIGIN` for step 4. After deploy, `https://<your-api>.onrender.com/api/health` should return `ok`. The free plan sleeps after inactivity, so the first request can take about 50 seconds.

**3. Web app on Vercel** (or Netlify). Import the repository. The root [`vercel.json`](vercel.json) (or [`netlify.toml`](netlify.toml)) already sets the build command, output folder and the single-page-app fallback. Add one environment variable before the first build:

```
VITE_API_BASE_URL=https://<your-api>.onrender.com
```

**4. Finish.** Go back to Render and set `CORS_ORIGIN` to the web app URL (for example `https://relay.vercel.app`), then redeploy the API.

---

## Demo scenario (≈ 3 minutes, no database edits)

Click **Load demo data** on the Dashboard first (or start with `SEED_ON_START=true`). The sample data contains every state. To walk the full story yourself:

1. **Dashboard** - the 7 KPI cards, the status pipeline and the **Needs attention** list. Two jobs are already in the Manual Queue; `RLY-1012` is flagged _No eligible rider_; `RLY-1008`’s confirmation is about to expire.
2. **Create a job** - _Jobs → New job_ (e.g. T. Nagar → Anna Nagar, 6 units). Notice the order reference is pre-filled: submitting twice (or double-clicking) returns the _same_ job - duplicate protection.
3. **Review recommendations** - open the new job. Riders are ranked with a score, a four-factor breakdown (travel / workload / capacity fit / deadline), and a plain-English _why_. Expand **“n riders not eligible”** to see why others were ruled out (offline, wrong zone, no capacity…).
4. **Assign** - click **Assign** on #1. The job moves to _Awaiting confirmation_ and a **countdown ring** appears; the rider’s capacity is _reserved_ (see _Riders_).
   Try **Override** on #2: a written reason is required and is stored in the audit trail.
5. **Shorten the timeout** - on the Dashboard, _Demo controls_: set the window to `0.5` minutes → _Apply_. Assign another job, wait 30 s - **or** click the second skip button (the window plus one minute) then **Run timeout sweep now**.
6. **Observe the timeout** - the job lands in the **Manual queue** with the reason _“Rider did not confirm in time”_. Open it: the _Assignment attempts_ card keeps the **Timed out** attempt, the _Activity history_ shows `Rider assigned → Assignment timed out → Moved to manual queue`, and the rider’s reserved capacity has been released.
7. **Investigate & reassign** - in the queue job, assign the next best rider (it is available for another attempt).
8. **Confirm or reject** - _Simulate: rider confirms_ (or _rejects_ → straight back to the Manual Queue; that rider is excluded for this job).
9. **Complete** - _Mark picked up_ → _Mark delivered_. Try _Mark delivered_ before pickup on another job: the API refuses (`409 INVALID_TRANSITION`).
10. **Cancel** any pre-pickup job; its reservation is released. The _Ledger integrity_ indicator (Dashboard) stays green throughout.

The same flow via the API is in [docs/API.md](docs/API.md#walkthrough-with-curl). The rider’s confirm/reject is simulated by
`POST /api/assignments/:id/accept|reject` (the UI sends it as the assigned rider).

---

## Repository layout

```
server/src
  domain/       pure, DB-free rules: state machine · eligibility + ranking · attention rules · travel data
  models/       Mongoose schemas + indexes (Job, Rider, Assignment, JobEvent)
  services/     use-cases: assignmentService · timeoutService · dispatchService · deliveryService · queueService ...
  routes/       thin HTTP handlers (validate → call a service → shape the response)
  middleware/   validation, actor identity, error mapping
  validation/   Zod schemas
server/tests    unit/ (pure rules) · integration/ (workflow, timeout, idempotency, concurrency, API, seed)
client/src
  api/          typed fetch client + TanStack Query hooks
  pages/        Dashboard · Jobs · JobDetail · ManualQueue · Riders
  components/   RecommendationPanel · Timeline · LifecycleStepper · DemoControls · ui primitives
docs/           API · system design · engineering notes · one-pager
```

## Assumptions & limitations (short list - full list in [Engineering notes](docs/ENGINEERING_NOTES.md))

- **No authentication.** The caller states who it is via `X-Actor-*` headers (the UI sends the dispatcher name you set in the sidebar). A rider-role actor can only act on their own assignment.
- **Simulated geography.** Seven named zones on a km grid; travel time is derived deterministically. No GPS.
- **Single API process** for the sweeper/clock/settings. All state-changing operations are safe under concurrency (compare-and-set), so more instances would be correct, but the _simulated clock_ and _runtime settings_ are per-process.
- Rider confirmation is simulated (button / API call); there is no rider app.
