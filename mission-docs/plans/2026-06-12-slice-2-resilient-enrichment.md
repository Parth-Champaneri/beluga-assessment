# Slice 2 — Resilient Clay enrichment (jobs table, dispatcher, sweeper, DLQ) (executed 2026-06-12)

Snapshot of the plan that was approved and executed. Source plan file:
`~/.claude/plans/typed-stirring-milner.md`.

## Context

Slice 1 shipped the happy-path enrichment loop
(`mission-docs/plans/2026-06-12-slice-1-clay-enrichment.md`): CSV upload →
press Enrich → backend loops through `pending` candidates with a 300ms gap →
POSTs each to Clay's webhook URL → Clay's HTTP-API column POSTs an
`enrichment_json` payload back to `/api/webhooks/clay`, matched by
`linkedin_url`. There are no retries, no explicit timeout, no rate-limit
handling, no recovery when Clay simply never calls back, and dispatch state
lives directly on `candidates` (`status` + a free-form `last_dispatch_error`).
The assessment names this hardening as the must-build robustness layer
(`mission-docs/Assesment-guidelines.md:24`).

This slice introduces a job lifecycle (`queued → dispatched → done | failed`)
backed by an `enrichment_jobs` table that **is the queue** — no external queue
library. One small background loop drives a **dispatcher** (sends queued rows
to Clay, fire-and-forget at 2xx) and a **sweeper** (recovers rows Clay never
called back on). The existing webhook endpoint is the **receiver** — it's
reactive, not a worker. A `CLAY_MOCK_MODE` env-gated mock provider lets us
demo every failure mode without burning the trial's 1k credits / 50-row cap.

Design choices confirmed with the user:
- **Custom worker, no queue library.** See "Why custom, not pg-boss" below.
- **`enrichment_jobs` is the only state.** Slim `candidates` to person data.
- **`CLAY_MOCK_MODE`** for credit-free demos.
- **Sequential dispatch** (concurrency 1) — gentle on Clay's free trial.
- **Polling worker** (3s tick). LISTEN/NOTIFY is the cleaner production
  pattern but adds ~30 LoC + a long-lived connection; deferred and flagged in
  the README's "with another week" section.

## Why custom, not pg-boss (decision log — survives in README + slice-2 snapshot)

pg-boss / graphile-worker / BullMQ were evaluated. Verdict: **moderately
overkill for this scope** (~50–100 candidates, sequential dispatch, one-shot
demo). The library's wins (retry math, delayed jobs, DLQ) are ~50 LoC we'd
otherwise write, and Clay's fire-and-forget + async-callback pattern doesn't
map cleanly to "run-to-completion" jobs — pg-boss needs a two-stage
`dispatch` + `callback-deadline` workaround that creates a second source of
truth synced by hand. For a take-home where "what you cut and why" is in the
rubric, a transparent ~120-LoC worker plus a one-paragraph README note
(naming the library and the threshold at which we'd reach for it) communicates
judgment more clearly than the library version would.

Time pressure (6–8h take-home, slice-2 lands in one session) also tips the
scale: shipping a small custom worker is faster than wiring pg-boss,
verifying its schema creation on Neon, and bending the two-stage workaround
into shape.

The trade-off is recorded in three durable places so it survives the commit:
- this plan, snapshotted to `mission-docs/plans/2026-06-12-slice-2-resilient-enrichment.md`
- a "Resilience" section in `README.md` (graders read this)
- the slice-2 changelog entry (bare-bones per `CLAUDE.md`, but the deferral
  is named)

## Mental model of the queue

The queue is just a Postgres table. A row is a "job." The worker is a tiny
loop. The webhook handler closes the loop reactively.

```
            ┌────────────────────────────────────────────────────────────┐
            │             enrichment_jobs  (one row per candidate)        │
            │                                                             │
            │   status: queued → dispatched → done                        │
            │                       │                                     │
            │                       └→ (callback never came) → queued     │
            │                                              ↘  or failed   │
            └────────────────────────────────────────────────────────────┘
                          ▲                  ▲                  ▲
                          │ writes           │ writes           │ writes
                          │                  │                  │
   ┌──────────────────────┴────┐   ┌─────────┴───────┐   ┌──────┴────────┐
   │ DISPATCHER (worker tick)  │   │ SWEEPER (worker │   │ RECEIVER       │
   │ — claims one due row      │   │   tick)         │   │ (webhook       │
   │ — POSTs to Clay           │   │ — finds stuck   │   │  endpoint)     │
   │ — on 2xx: status=dispat-  │   │   dispatched    │   │ POST /api/web- │
   │   ched + dispatched_at    │   │   rows          │   │  hooks/clay    │
   │ — on err: status=queued + │   │ — re-queues or  │   │ — match on     │
   │   next_attempt_at=backoff │   │   marks failed  │   │   linkedin_url │
   │ — on perm/4xx or max:     │   │                 │   │ — save enrich- │
   │   status=failed           │   │                 │   │   ment, status │
   │                           │   │                 │   │   = done       │
   │  FIRE-AND-FORGET at 2xx   │   │  SAFETY NET     │   │  REACTIVE      │
   └───────────────────────────┘   └─────────────────┘   └────────────────┘
                  ▲                          ▲                   ▲
                  │ same loop, every 3s      │                   │
                  └──────────────┬───────────┘                   │
                                 │                               │
                  ┌──────────────┴──────────────┐                │
                  │ startEnrichmentWorker({db}) │                │
                  │   every 3s:                 │                │
                  │     sweeperPass(db)         │                │
                  │     dispatcherPass(db)      │                │
                  └─────────────────────────────┘                │
                                                                 │
                                                  ┌──────────────┴────────┐
                                                  │   Clay's HTTP-API     │
                                                  │   column POSTs back   │
                                                  │   (async, 3–30s after │
                                                  │    dispatch — or never)
                                                  └───────────────────────┘
```

Three concerns, only one of which is a worker:

1. **Dispatcher** — picks up `queued` rows and pushes them to Clay. Its job
   ends at the 2xx ack. It does not wait for the enrichment. Fire-and-forget.
2. **Sweeper** — runs in the same loop as the dispatcher. Its job is to
   notice rows that have been sitting in `dispatched` too long and decide
   whether to give Clay another chance (re-queue with backoff) or give up
   (mark `failed`). This is the *only* mechanism for recovering from "Clay
   ate the job and never called back."
3. **Receiver** — the existing `POST /api/webhooks/clay` Express route. Not
   a worker. Clay calls *us*. We match by `linkedin_url`, write the
   enrichment, flip the job to `done`. If the row was already `done`, we
   overwrite (idempotent). If it was `failed` (we gave up but Clay arrived
   late), we accept it anyway and log loudly.

The whole thing is one process, one Postgres table, one HTTP route, one tiny
loop.

## How each piece works (concrete pseudocode)

### Dispatcher tick

```ts
async function dispatcherPass(db) {
  // 0. Rate-limit gate: if we got a 429 recently, sit out this tick.
  if (rateLimitGateUntil > Date.now()) return

  // 1. Claim ONE due job atomically. The UPDATE...WHERE guarantees that
  //    even with multiple workers (we only run one), no two ticks can
  //    pick the same row.
  const claimed = await db.execute(sql`
    UPDATE enrichment_jobs
       SET status         = 'dispatched',
           attempt_count  = attempt_count + 1,
           last_attempt_at = now(),
           dispatched_at  = now()
     WHERE id = (
       SELECT id FROM enrichment_jobs
        WHERE status = 'queued'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *;
  `)
  if (!claimed) return  // nothing due — idle this tick

  // 2. Fire the POST. AbortController enforces dispatch timeout.
  const candidate = await candidatesRepo.get(db, claimed.candidate_id)
  const result = await dispatchToClay({                  // → clay.ts
    candidate_id: candidate.id,
    full_name:    candidate.fullName,
    linkedin_url: candidate.linkedinUrl,
    email:        candidate.email,
  })

  // 3. Handle the result. Dispatcher's job ends here either way.
  if (result.ok) {
    // 2xx ack. Leave the row as 'dispatched'. The sweeper will check on it
    // in CALLBACK_TIMEOUT minutes if no callback arrives.
    log(`[dispatcher] ✓ dispatched candidate=${candidate.id}`)
    return
  }

  if (result.code === 'http_4xx' || result.code === 'config') {
    // Permanent. Don't burn retries on something that can't succeed.
    await jobsRepo.markFailed(db, claimed.id, {
      code: result.code, message: result.message,
    })
    return
  }

  // Transient (network, timeout, 5xx, 429). Decide: retry or give up?
  if (claimed.attempt_count >= MAX_ATTEMPTS) {
    await jobsRepo.markFailed(db, claimed.id, {
      code: result.code, message: result.message,
    })
    return
  }

  // 429: honor Retry-After AND set the global gate so other dispatches pause.
  const delay = result.code === 'http_429'
    ? Math.max(result.retryAfterSeconds ?? 30, backoff(claimed.attempt_count))
    : backoff(claimed.attempt_count)
  if (result.code === 'http_429') {
    rateLimitGateUntil = Date.now() + (result.retryAfterSeconds ?? 30) * 1000
  }
  await jobsRepo.revertToQueued(db, claimed.id, {
    code: result.code, message: result.message, delaySeconds: delay,
  })
}

function backoff(attempt) {
  // attempt 1 → 5s, 2 → 30s, 3 → 2m, 4 → 10m, 5 → 1h, with ±20% jitter.
  const schedule = [5, 30, 120, 600, 3600]
  const base = schedule[Math.min(attempt - 1, schedule.length - 1)]
  return base * (0.8 + Math.random() * 0.4)
}
```

### Sweeper tick

```ts
async function sweeperPass(db) {
  // Find rows we POSTed to Clay but haven't heard back from. Two outcomes:
  //   - still have retry budget → put them back into the queue with backoff
  //   - out of budget          → mark failed (DLQ)
  // ONE SQL statement handles both cases atomically:
  await db.execute(sql`
    UPDATE enrichment_jobs
       SET status            = CASE WHEN attempt_count < ${MAX_ATTEMPTS}
                                    THEN 'queued' ELSE 'failed' END,
           next_attempt_at   = CASE WHEN attempt_count < ${MAX_ATTEMPTS}
                                    THEN now() + interval '30 seconds'
                                    ELSE next_attempt_at END,
           completed_at      = CASE WHEN attempt_count < ${MAX_ATTEMPTS}
                                    THEN NULL ELSE now() END,
           last_error_code   = 'callback_timeout',
           last_error_message = 'Clay did not call back within '
                              || ${CALLBACK_TIMEOUT_SECONDS} || 's'
     WHERE status = 'dispatched'
       AND dispatched_at < now() - interval '${CALLBACK_TIMEOUT_SECONDS} seconds';
  `)
  // We don't log per-row here; a single line "[sweeper] recovered N rows" is
  // enough. The UI shows the state change.
}
```

### Receiver (already mostly exists — small edit)

```ts
// POST /api/webhooks/clay  (callback.ts, unchanged endpoint shape)
//   1. Verify x-callback-secret.
//   2. Zod-parse { linkedin_url, enrichment_json }.
//   3. Normalize linkedin_url.
//   4. In ONE tx:
//        - UPDATE candidates SET enrichment = $payload, enriched_at = now()
//          WHERE linkedin_url = $normalized
//        - UPDATE enrichment_jobs SET status = 'done',
//          completed_at = now(), last_error_code = NULL,
//          last_error_message = NULL WHERE candidate_id = (the matched id)
//   5. If the job was 'failed', accept anyway and log loudly.
//   6. If no candidate matches, 404 + log (Clay sent us an unknown URL).
```

### Worker entry point

```ts
// worker.ts
export function startEnrichmentWorker({ db }) {
  let stopping = false
  let timer = null

  async function tick() {
    if (stopping) return
    try {
      await sweeperPass(db)       // cheap SQL UPDATE
      await dispatcherPass(db)    // claim one + dispatch
    } catch (err) {
      console.error('[worker] tick error', err)
    } finally {
      if (!stopping) timer = setTimeout(tick, env.ENRICH_WORKER_INTERVAL_MS)
    }
  }
  timer = setTimeout(tick, 0)

  return { stop: async () => { stopping = true; if (timer) clearTimeout(timer) } }
}
// index.ts wires startEnrichmentWorker({ db }) after app.listen, calls stop()
// on SIGTERM/SIGINT.
```

That's the whole worker. Sweeper + dispatcher + tick scheduler = ~80 LoC.

## State transition table (handy for the walkthrough)

| Event                                            | Row goes …                                                |
|--------------------------------------------------|-----------------------------------------------------------|
| CSV ingest creates candidate                     | inserts `enrichment_jobs` row, `status=queued`            |
| "Enrich pending" clicked                         | sets `next_attempt_at = now()` on all `queued` rows       |
| Dispatcher claims a row                          | `queued → dispatched`, attempt_count++                    |
| Clay returns 2xx                                 | stays `dispatched` (awaiting callback)                    |
| Clay returns 429                                 | `dispatched → queued`, next_attempt_at = now + max(Retry-After, backoff); global gate set |
| Clay returns 5xx / network / timeout             | `dispatched → queued`, next_attempt_at = now + backoff    |
| Clay returns 4xx permanent                       | `dispatched → failed`                                     |
| attempt_count ≥ MAX on transient                 | `dispatched → failed`                                     |
| Sweeper sees `dispatched` older than 15min       | `dispatched → queued` (or `failed` if out of budget)      |
| Webhook arrives                                  | `dispatched → done` (or `failed → done` with a loud log)  |
| "Retry failed" clicked                           | `failed → queued`, attempt_count=0, errors cleared        |

## Idempotency, point by point

| Concern                                            | Defense                                                                                 |
|----------------------------------------------------|-----------------------------------------------------------------------------------------|
| Re-upload the same CSV                             | `linkedin_url` UNIQUE upsert (slice 1); job row stays as-is                             |
| Double-click "Enrich pending"                      | `UPDATE … WHERE status='queued'` is naturally idempotent                                |
| Two worker ticks race                              | Atomic claim via `UPDATE … WHERE status='queued' … RETURNING` — only one wins           |
| Same callback delivered twice                      | UPDATE overwrites with identical data — no-op                                           |
| Callback for a row already `done`                  | Same UPDATE re-runs — no harm                                                           |
| Callback for a `failed` row (late delivery)        | Accepted; flips to `done`; logged loudly so we know it happened                         |
| Worker re-dispatches a row that's already dispatched | Impossible — claim query requires `status='queued'`                                   |

There is no Clay-side idempotency key — Clay treats each POST as a new row in
its table. Our defense is entirely on our side: we *never* POST while the row
is `dispatched`. The sweeper is the only path that can move a row out of
`dispatched` back into `queued`, and only after CALLBACK_TIMEOUT.

## Schema migration

Edit `backend/src/features/candidates/schema.ts`, then
`npm run db:generate` + `npm run db:migrate`.

**New table `enrichment_jobs`** (one row per candidate, `UNIQUE(candidate_id)`):

| column                | type                    | notes                                                                       |
|-----------------------|-------------------------|-----------------------------------------------------------------------------|
| `id`                  | uuid PK, defaultRandom  |                                                                             |
| `candidate_id`        | uuid NOT NULL, UNIQUE   | FK → `candidates.id` ON DELETE CASCADE                                      |
| `status`              | text NOT NULL           | enum: `queued` \| `dispatched` \| `done` \| `failed`, default `queued`      |
| `attempt_count`       | int NOT NULL default 0  |                                                                             |
| `next_attempt_at`     | timestamptz NOT NULL    | default `now()` — dispatcher only claims rows where this is `<= now()`      |
| `last_attempt_at`     | timestamptz null        |                                                                             |
| `dispatched_at`       | timestamptz null        | set on dispatch; sweeper reads this                                         |
| `completed_at`        | timestamptz null        | set when status → `done` or `failed`                                        |
| `last_error_code`     | text null               | `network` \| `timeout` \| `http_429` \| `http_5xx` \| `http_4xx` \| `callback_timeout` \| `config` |
| `last_error_message`  | text null               | free-form (preserves slice-1 observability)                                 |
| `created_at`          | timestamptz NOT NULL    | default `now()`                                                             |

Index `(status, next_attempt_at)` for the dispatcher's claim query.

**Slim `candidates` to person data only** — these columns move to jobs:
- Drop `status`, `sent_at`, `enriched_at`, `last_dispatch_error`.
- Keep `enrichment` (the JSON blob is the enriched person, not the attempt).

**No backfill** — user will wipe existing candidates before running the
migration (`TRUNCATE candidates CASCADE;` or `DELETE FROM candidates;` in
`db:studio` is fine). The drizzle-generated migration can be applied as-is.

Re-export the new table from `backend/src/db/schema.ts`.

## Files to add / modify

Keep everything under `features/candidates/` (one cohesive feature folder per
`CLAUDE.md` convention).

**Add:**
- `backend/src/features/candidates/jobs-repo.ts` — `ensureJobForCandidate`,
  `getJob`, `markDispatched` (the claim query), `revertToQueued`, `markFailed`,
  `markDone`, `resetFailedToQueued`, `nudgeAllQueued`, `pendingCount`,
  `failedCount`.
- `backend/src/features/candidates/worker.ts` — `startEnrichmentWorker({db})`
  returning `{stop}`. Owns the tick loop, dispatcher pass, sweeper pass,
  in-memory `rateLimitGateUntil`.
- `backend/src/features/candidates/clay-mock.ts` — deterministic by
  `hash(candidate_id) % 10` (see Mock Clay below).

**Modify:**
- `backend/src/features/candidates/schema.ts` — add `enrichmentJobs`; drop the
  four columns from `candidates`. Update exported types.
- `backend/src/features/candidates/clay.ts` — `AbortController` w/ timeout;
  return typed result `{ok: true} | {ok: false, code, message,
  retryAfterSeconds?}` (network/timeout still throw — caller categorizes).
  Routes to `dispatchToClayMock` when `env.CLAY_MOCK_MODE` is set.
- `backend/src/features/candidates/repo.ts` — `listCandidates` LEFT JOINs
  `enrichment_jobs`, returns merged shape the frontend consumes. Upsert helper
  calls `ensureJobForCandidate` for each newly-inserted candidate.
- `backend/src/features/candidates/service.ts` — replace the synchronous
  `enrichAll` dispatch loop with `nudgeQueued` (mass UPDATE `next_attempt_at
  = now()` on `queued` rows). Add `retryFailed`. Update `applyCallback` to
  mark the job `done` in the same tx that writes enrichment; late callback on
  `failed` row is accepted and logged.
- `backend/src/features/candidates/callback.ts` — call the updated
  `applyCallback`.
- `backend/src/features/candidates/router.ts` — rename `enrichAll` mutation
  to `nudgeQueued` (keep `enrichAll` as a one-release passthrough alias). Add
  `retryFailed` mutation.
- `backend/src/db/schema.ts` — re-export `enrichmentJobs`.
- `backend/src/index.ts` — start the worker after `app.listen`; await
  `worker.stop()` on SIGTERM/SIGINT.
- `backend/src/lib/env.ts` — add `CLAY_MOCK_MODE`,
  `ENRICH_MAX_ATTEMPTS` (default 5),
  `ENRICH_CALLBACK_TIMEOUT_SECONDS` (default 900),
  `ENRICH_WORKER_INTERVAL_MS` (default 3000),
  `ENRICH_DISPATCH_TIMEOUT_MS` (default 30000).
- `backend/.env.example` — document all new vars.

**Frontend** (`frontend/src/components/candidates-table.tsx`):
- `failed` badge (destructive variant).
- Row expansion: "Attempts: N/5 · Next retry: <relative> · Error: <code> —
  <message>" — render only non-null fields.
- New "Retry failed (N)" button next to "Enrich pending (N)"; disabled when N=0.
- `refetchInterval: 2000` while any row is `queued` or `dispatched`.
- `lastDispatchError` red-box becomes `lastErrorMessage` (renamed field).

**Docs:**
- `mission-docs/changelog.md` — one entry per landing commit.
- `mission-docs/plans/2026-06-12-slice-2-resilient-enrichment.md` — snapshot of
  this plan.
- `CLAUDE.md` Features subsection — describe dispatcher + sweeper + receiver.
- README — note the "why custom worker, not pg-boss" trade-off for the
  walkthrough.

## Mock Clay provider

`backend/src/features/candidates/clay-mock.ts`. Gated by `CLAY_MOCK_MODE=1`.
`clay.ts:dispatchToClay` routes to it when set; same input/output contract.

```
hash(candidate_id) % 10:
  0–6 (70%): respond 200, then 3–8s later fire a synthetic POST to
             http://localhost:PORT/api/webhooks/clay carrying x-callback-secret
             and a fake enrichment_json { headline, location, experiences:[] }.
  7   (10%): respond 429 with header "Retry-After: 30"
  8   (10%): respond 500
  9   (10%): never respond — sleep > ENRICH_DISPATCH_TIMEOUT_MS so the
             AbortController fires. Also forces the sweeper path (2xx with no
             callback) if we tweak the hash bucket for a specific candidate.
```

The synthetic callback uses the dispatch's `linkedin_url`, so the real
callback endpoint + matching logic stay exercised end-to-end.

## Env additions

```
CLAY_MOCK_MODE=                # any truthy value → use clay-mock
ENRICH_MAX_ATTEMPTS=5
ENRICH_CALLBACK_TIMEOUT_SECONDS=900    # 15 min — sweeper threshold
ENRICH_WORKER_INTERVAL_MS=3000         # how often the worker ticks
ENRICH_DISPATCH_TIMEOUT_MS=30000       # AbortController timeout on the POST
```

All optional with the defaults shown.

## Phased rollout — merged into 3 commits per user direction

Per user direction (2026-06-12): the 8 sub-phases below merge into **3
commits**. Implementation runs as a **sequential multi-agent workflow** (one
agent per merged phase). Each agent commits once with a brief message and
returns manual-testing instructions; the user verifies after the workflow
finishes (no dev servers spun up by the agents).

**Merged commit map:**

| Merged phase | Sub-phases included | Brief commit message                                    |
|--------------|---------------------|---------------------------------------------------------|
| **Phase A**  | Sub-phases 1 + 2    | `feat(enrichment): jobs table + state refactor`         |
| **Phase B**  | Sub-phases 3–7      | `feat(enrichment): resilient worker + mock + UI`        |
| **Phase C**  | Sub-phase 8         | `docs(slice-2): plan snapshot + resilience notes`       |

**Per-agent contract:**
- Reads this plan file.
- Executes every sub-phase listed in its merged phase, in order.
- Runs `npm run typecheck` in both `backend/` and `frontend/` at the end.
- Appends **one combined changelog entry** for the merged phase (not one per
  sub-phase) — bare-bones per `CLAUDE.md` discipline.
- Creates **one commit** with the brief message above.
- Returns a structured **manual-testing block** for the sub-phases it
  shipped, which gets folded into the final testing guide.
- Does NOT start the dev server, does NOT run `db:migrate` for sub-phase 1
  without first running the user's `TRUNCATE candidates CASCADE;` preflight
  (Phase A agent will instruct the user to run that preflight before
  proceeding, then run `db:generate` + `db:migrate` itself).

The sub-phase blocks below are the agents' detailed briefs.

### Phase 1 — Schema + migration (no backfill)
- **Deliverable:** `enrichment_jobs` exists; `candidates` is slim.
- **Preflight (manual, user):** wipe existing candidates so the drop is
  clean — `TRUNCATE candidates CASCADE;` (or `DELETE FROM candidates;`) in
  `db:studio`. No production data to preserve.
- **Files:**
  - Edit `backend/src/features/candidates/schema.ts`: add `enrichmentJobs`
    table; drop `status` / `sent_at` / `enriched_at` / `last_dispatch_error`
    from `candidates`. Index `(status, next_attempt_at)`.
  - Re-export from `backend/src/db/schema.ts`.
  - `npm run db:generate` → apply the generated SQL migration as-is (no
    hand-edit needed; no backfill block).
  - `npm run db:migrate`.
- **Verify:** `db:studio` — `enrichment_jobs` exists with the right shape;
  `candidates` no longer has the four dropped columns. `typecheck` clean on
  backend.
- **Changelog:** `## YYYY-MM-DD — enrichment_jobs table + slim candidates`.
- **Commit:** `feat(enrichment): add enrichment_jobs table + slim candidates`

### Phase 2 — Repo + service refactor (sync dispatch unchanged)
- **Deliverable:** All slice-1 behavior identical, but state lives in jobs.
- **Files:**
  - Add `backend/src/features/candidates/jobs-repo.ts`:
    `ensureJobForCandidate`, `getJob`, `claimNextDue` (the atomic UPDATE),
    `revertToQueued`, `markFailed`, `markDone`, `resetFailedToQueued`,
    `nudgeAllQueued`, `pendingCount`, `failedCount`, `sweepStuckDispatched`.
  - Update `candidates/repo.ts:listCandidates` to LEFT JOIN jobs; return the
    merged row shape (status + new fields).
  - Update `candidates/repo.ts:upsertCandidates` to call
    `ensureJobForCandidate` for newly-inserted rows.
  - Update `candidates/service.ts:enrichAll` to read/write through jobs-repo
    (still the synchronous loop — worker comes in Phase 5).
  - Update `candidates/service.ts:applyCallback` to mark the job `done` in
    one transaction with the enrichment write; accept late callback on a
    `failed` job (flip to `done`, log loudly).
  - Update `candidates/callback.ts` for the new `applyCallback` shape.
  - Update `candidates/router.ts:list` return type (frontend picks it up via
    `AppRouter` end-to-end types — no extra wiring).
  - Minimal frontend touch: rename the `lastDispatchError` field reference to
    `lastErrorMessage` if needed to keep `typecheck` clean. Full UI changes
    land in Phase 7.
- **Verify:** upload + Enrich still works end-to-end (against real Clay or
  defer to Phase 4's mock). Re-upload is still idempotent.
  Both `typecheck`s clean.
- **Changelog:** `## YYYY-MM-DD — move dispatch state into enrichment_jobs`.
- **Commit:** `refactor(enrichment): move dispatch state into enrichment_jobs`

### Phase 3 — Dispatch hardening in `clay.ts`
- **Deliverable:** Timeouts enforced; HTTP errors typed instead of thrown.
- **Files:**
  - Edit `candidates/clay.ts`: wrap `fetch` in `AbortController` driven by
    `env.ENRICH_DISPATCH_TIMEOUT_MS`. Return typed result
    `{ok: true} | {ok: false, code, message, retryAfterSeconds?}` for HTTP
    paths. Network / abort errors still throw — the caller categorizes them
    into `network` / `timeout` codes.
  - Add `ENRICH_DISPATCH_TIMEOUT_MS` (default 30000) to `lib/env.ts` and
    `.env.example`.
- **Verify:** point at a deliberately bad URL → see `timeout` / `network`
  log paths. Real 5xx → typed result with `code: 'http_5xx'`.
- **Changelog:** `## YYYY-MM-DD — typed dispatch result + AbortController timeout`.
- **Commit:** `feat(enrichment): typed dispatch result + AbortController timeout`

### Phase 4 — Mock Clay provider
- **Deliverable:** End-to-end demoable without burning Clay credits.
- **Files:**
  - Add `candidates/clay-mock.ts`: `dispatchToClayMock(input)` with the same
    contract as `dispatchToClay`. Hash bucket logic (0–6 → 200 + delayed
    self-POST to `/api/webhooks/clay`; 7 → 429+Retry-After:30; 8 → 500;
    9 → never respond).
  - Edit `clay.ts:dispatchToClay` to short-circuit to `dispatchToClayMock`
    when `env.CLAY_MOCK_MODE` is truthy.
  - Add `CLAY_MOCK_MODE` to `lib/env.ts` + `.env.example`.
- **Verify:** `CLAY_MOCK_MODE=1 npm run dev`, ingest 10 candidates, hit
  Enrich, observe each error bucket fire in logs.
- **Changelog:** `## YYYY-MM-DD — env-gated mock Clay provider`.
- **Commit:** `feat(enrichment): env-gated mock Clay provider`

### Phase 5 — Background worker (dispatcher pass)
- **Deliverable:** Async, retrying dispatch driven by the jobs table.
- **Files:**
  - Add `candidates/worker.ts`:
    - `startEnrichmentWorker({db})` → `{stop}`
    - `dispatcherPass(db)` (claim → POST → handle result, see pseudocode
      block in "How each piece works").
    - In-module `rateLimitGateUntil: number` + 429 handling.
    - Backoff schedule `[5s, 30s, 2m, 10m, 1h]` with ±20% jitter.
  - Wire `startEnrichmentWorker` into `backend/src/index.ts` after
    `app.listen`; `await worker.stop()` on `SIGTERM`/`SIGINT`.
  - Replace `service.ts:enrichAll` with `nudgeQueued` (mass UPDATE
    `next_attempt_at = now()` on `queued` rows). Add `nudgeQueued` mutation
    to `router.ts`; keep `enrichAll` as a one-release passthrough alias so
    the slice-1 UI doesn't break before Phase 7.
  - Add `ENRICH_MAX_ATTEMPTS` (default 5) and `ENRICH_WORKER_INTERVAL_MS`
    (default 3000) to `lib/env.ts` + `.env.example`.
- **Verify:** `CLAY_MOCK_MODE=1`, queue 20 candidates, watch them flow
  `queued → dispatched → done`. 429/500/timeout buckets retry with visible
  backoff in logs and `next_attempt_at`. Global rate gate pauses dispatches
  after a 429.
- **Changelog:** `## YYYY-MM-DD — background worker + dispatcher pass`.
- **Commit:** `feat(enrichment): background worker + dispatcher pass`

### Phase 6 — Sweeper (catches "Clay never came back")
- **Deliverable:** Stuck `dispatched` rows recover or DLQ automatically.
- **Files:**
  - Add `sweeperPass(db)` to `worker.ts`; call it before `dispatcherPass`
    every tick.
  - Add `ENRICH_CALLBACK_TIMEOUT_SECONDS` (default 900) to `lib/env.ts` +
    `.env.example`.
- **Verify:** temporarily set `ENRICH_CALLBACK_TIMEOUT_SECONDS=60` and use
  the mock's "never respond" bucket. Stuck rows re-queue, eventually land in
  `failed` after MAX_ATTEMPTS. Also test by backdating `dispatched_at`
  manually in `db:studio` on a real-Clay row.
- **Changelog:** `## YYYY-MM-DD — sweeper for stuck dispatched rows`.
- **Commit:** `feat(enrichment): sweeper for stuck dispatched rows`

### Phase 7 — retryFailed mutation + frontend
- **Deliverable:** Users can see and recover failed candidates.
- **Files:**
  - Add `service.ts:retryFailed` (resets `failed` jobs to `queued`,
    `attempt_count=0`, clears error fields). Add `retryFailed` mutation in
    `router.ts`.
  - Edit `frontend/src/components/candidates-table.tsx`:
    - `failed` status badge (destructive variant).
    - Row expansion: "Attempts: N/MAX · Next retry: <relative> ·
      Error: `<code>` — `<message>`" (render only non-null fields).
    - "Retry failed (N)" button next to "Enrich pending (N)"; disabled when
      N=0.
    - `refetchInterval: 2000` while any row is `queued` or `dispatched`.
    - Rename `lastDispatchError` UI block to `lastErrorMessage`.
- **Verify:** with mock, drive several candidates to `failed`, click Retry,
  watch them flow back through. Badge visible; attempts/next-retry strings
  render correctly.
- **Changelog:** `## YYYY-MM-DD — retry-failed mutation + UI affordances`.
- **Commit:** `feat(enrichment): retry-failed mutation + UI affordances`

### Phase 8 — Docs (slice-2 snapshot, CLAUDE.md, README)
- **Deliverable:** The work is discoverable and the pg-boss decision survives.
- **Files:**
  - Snapshot this plan to
    `mission-docs/plans/2026-06-12-slice-2-resilient-enrichment.md`,
    including the "Why custom, not pg-boss" section verbatim.
  - Update the `CLAUDE.md` Features subsection: describe dispatcher,
    sweeper, receiver, and the jobs-table state machine.
  - Update `README.md`: short "Resilience" section that
    (a) names pg-boss / graphile-worker as evaluated libraries,
    (b) explains the cut at this scope,
    (c) names the threshold at which we'd reach for them ("~10k+
    candidates/min, or once we add concurrent dispatch beyond 1"),
    (d) documents the new env vars (`CLAY_MOCK_MODE`,
    `ENRICH_MAX_ATTEMPTS`, `ENRICH_CALLBACK_TIMEOUT_SECONDS`,
    `ENRICH_WORKER_INTERVAL_MS`, `ENRICH_DISPATCH_TIMEOUT_MS`) so graders
    can run the demo.
  - Also add "with another week" bullets: LISTEN/NOTIFY, concurrent
    dispatch with `FOR UPDATE SKIP LOCKED`, per-row retry button.
- **Verify:** open the snapshot, README, and CLAUDE.md side-by-side — the
  pg-boss decision and env-var docs are consistent across all three.
- **Changelog:** `## YYYY-MM-DD — slice-2 docs (plan snapshot + README resilience)`.
- **Commit:** `docs(slice-2): plan snapshot + README resilience section`

### Phase 9 — Real-Clay smoke test (no commit unless something breaks)
- `CLAY_MOCK_MODE=` (off). Ingest ~10 real candidates against the live Clay
  table. Watch the happy path. Then force a failure (kill ngrok mid-run)
  and confirm the sweeper recovers in the CALLBACK_TIMEOUT window.
- If something breaks, the fix is its own small commit with its own
  changelog entry.

## End-of-slice acceptance checklist

(Run after Phase 8; satisfies the "handle failures, timeouts, rate limits with
retries and idempotency, and decide what happens to the ones that never come
back" requirement from `Assesment-guidelines.md:24`.)

- [ ] Mock mode exercises every error category (200, 429, 500, timeout) and
  per-row attempt/error display reflects the path taken.
- [ ] Sweeper recovers a stuck `dispatched` row.
- [ ] 429 with Retry-After: global gate pauses dispatches; affected
  candidate retries with `max(Retry-After, backoff)`.
- [ ] Re-ingesting the same CSV does not reset job state or re-dispatch.
- [ ] After `ENRICH_MAX_ATTEMPTS`, jobs land in `failed` with
  `last_error_code` set; "Retry failed" puts them back through.
- [ ] Server restart with in-flight `dispatched` rows: rows survive on
  boot; sweeper picks them up at the CALLBACK_TIMEOUT.
- [ ] Real-Clay run (mock off) with ~10 candidates: all reach `done`.
- [ ] Slice-2 plan snapshot, CLAUDE.md Features, README Resilience section,
  and per-phase changelog entries all landed and consistent.
