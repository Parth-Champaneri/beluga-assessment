# Beluga Assessment

Two independent npm projects in `frontend/` and `backend/`, run side-by-side.

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + Shadcn/ui + tRPC v11 + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev) + tRPC v11 + Drizzle ORM on Neon serverless Postgres. Port **4000**.

See `CLAUDE.md` for detailed architecture, conventions, and commands.

## Quick start

```bash
# backend
cd backend
cp .env.example .env   # fill in DATABASE_URL
npm install
npm run db:migrate     # applies drizzle migrations to Neon
npm run dev

# frontend (in a separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Clay enrichment setup

The backend POSTs candidates to a Clay table's webhook URL, and Clay POSTs the
enriched row back to `/api/webhooks/clay`. The table has to be built once in
the Clay UI — Clay has no programmatic API for creating tables or columns.

1. **Create a Clay table** with a Webhook source. The source's columns should
   match the fields the backend sends: `candidate_id`, `full_name`,
   `linkedin_url`, `email`. Copy the webhook URL and auth token into
   `backend/.env` as `CLAY_WEBHOOK_URL` and `CLAY_WEBHOOK_AUTH`.
2. **Add an "Enrich Person from LinkedIn URL"** column (or the waterfall of
   your choice) so each new row gets enriched.
3. **Add an "HTTP API" column** as the final step. Configure it to POST to
   `https://<your-tunnel>/api/webhooks/clay`, with header
   `x-callback-secret: <your-secret>` (matching `CLAY_CALLBACK_SECRET` in
   `backend/.env`). Body must be `{ "linkedin_url": "<LinkedIn URL chip>",
   "enrichment_json": { ...whatever fields you want stored... } }`. The
   backend matches the row by `linkedin_url` (normalized) and persists
   `enrichment_json` verbatim as the candidate's `enrichment` jsonb.
   Include at least `headline` inside `enrichment_json` so the UI table has
   something to show.
4. **Expose your local backend** with ngrok or cloudflared so Clay's HTTP API
   column can reach it: `ngrok http 4000`. Paste the public URL into the HTTP
   API column from step 3.
5. **Run a small batch first** (2–3 candidates) before the full set — the Clay
   trial is ~1,000 credits, so cold runs can chew through your budget fast.

## Resilience

Slice 2 layers a job queue, retries, a callback-timeout sweeper, and a DLQ on
top of the slice-1 happy path. An `enrichment_jobs` row per candidate moves
through `queued → dispatched → done | failed`. A 3s tick runs a **sweeper**
(recovers rows Clay never called back on) and a **dispatcher** (claims one due
row atomically, POSTs to Clay, fire-and-forget at 2xx). The existing
`POST /api/webhooks/clay` route is the **receiver** — Clay calls us, we match
by `linkedin_url`, flip the job to `done`.

### Why a custom worker, not pg-boss

**pg-boss** and **graphile-worker** were evaluated. Both are well-built and
would handle retry math, delayed jobs, and a DLQ table out of the box. At this
scope they're moderately overkill:

- **Volume.** ~50–100 candidates, sequential dispatch, a one-shot demo. The
  library's wins (retry math, delayed jobs, DLQ) are ~50 LoC we'd otherwise
  write.
- **Shape mismatch.** Clay is fire-and-forget with an async callback. A
  pg-boss job is run-to-completion — to fit Clay's pattern you'd run a
  two-stage job (`dispatch`, then a separate `callback-deadline` job
  scheduled after dispatch), which creates a second source of truth that has
  to be synced by hand.
- **Cut threshold.** We'd reach for pg-boss / graphile-worker once we cross
  ~10k+ candidates/min, or as soon as we add concurrent dispatch beyond 1
  (the locking, fairness, and queue partitioning math is worth not writing).

The transparent ~120-LoC worker (`features/candidates/worker.ts`) is faster
to ship in a take-home timebox and reads more clearly when graders walk it.

### Env vars

All optional; defaults shown. Add to `backend/.env` to override.

| Var                                | Default | What it does                                                          |
|------------------------------------|---------|-----------------------------------------------------------------------|
| `CLAY_MOCK_MODE`                   | unset   | Any truthy value (e.g. `1`) routes dispatch to the mock provider — deterministic 70% ok / 10% 429 / 10% 500 / 10% never-respond buckets by `hash(candidate_id) % 10`. Fires synthetic callbacks for the ok bucket so the receiver stays exercised. No Clay credits burned. |
| `ENRICH_MAX_ATTEMPTS`              | `5`     | Transient errors retry until this; then the job lands in `failed`.    |
| `ENRICH_CALLBACK_TIMEOUT_SECONDS`  | `900`   | Sweeper threshold. A `dispatched` row older than this gets re-queued (or DLQ'd if out of budget). 15 min default; set to `60` to demo the sweeper quickly. |
| `ENRICH_WORKER_INTERVAL_MS`        | `3000`  | How often the worker ticks.                                           |
| `ENRICH_DISPATCH_TIMEOUT_MS`       | `30000` | `AbortController` timeout on the POST to Clay.                        |

### With another week

- **LISTEN/NOTIFY** for event-driven wake-up — cuts idle polling and pushes
  enrichment latency closer to zero between ticks.
- **Concurrent dispatch** with `FOR UPDATE SKIP LOCKED` claiming N rows at
  once, with bounded team size — straightforward extension of the current
  atomic claim, blocked today on Clay's rate budget being tight.
- **Per-row retry button** in the UI alongside the existing
  "Retry failed (N)" batch action.
- **Mock observability overlay** — a small visualizer showing the
  hash-bucket distribution of seeded candidates so demos can target a specific
  failure mode on demand.
