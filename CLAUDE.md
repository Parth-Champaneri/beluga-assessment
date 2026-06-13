# CLAUDE.md

Guidance for Claude Code working in this repository.

## Changelog discipline

`mission-docs/changelog.md` logs functional changes. **Append an entry in the
same response that makes the change.** Newest on top.

**Keep entries bare-bones.** Format:

```
## YYYY-MM-DD — One-line title
**Request:** one sentence on what the user asked.
**Changes:** 1–3 bullets on what shipped.
```

No long prose, no exhaustive file lists. If you can't say it in a few lines,
you're saying too much.

**Log:** new features, flows, endpoints, schema/dep changes, removed surface,
architectural decisions. **Skip:** styling, copy, behavior-preserving
refactors, invisible bug fixes, no-op dep bumps.

Mission lives in `mission-docs/mission.md` — update when product direction
shifts.

## Repo Layout

Two independent npm projects in `frontend/` and `backend/`, run side-by-side.
There is no root `package.json` — install/run each side separately.

- `frontend/` — Vite + React 19, TypeScript, Tailwind v4, Shadcn/ui, tRPC v11
  client + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev), tRPC v11, Drizzle ORM
  on Postgres via `pg` (node-postgres). Port **4000**. Hosted on Neon.

## Common Commands

Backend (`cd backend`):
- `npm run dev` — tsx watch on `src/index.ts`
- `npm run build` / `npm start` — tsc to `dist/`, then `node dist/index.js`
- `npm run typecheck`
- `npm run db:generate` — drizzle-kit generates a new SQL migration in
  `drizzle/` after editing any `features/*/schema.ts`
- `npm run db:migrate` — applies pending migrations against Neon
- `npm run db:studio` — Drizzle Studio UI

Frontend (`cd frontend`):
- `npm run dev` / `build` / `preview`
- `npm run lint`
- `npm run typecheck`

No test runner is configured in either project.

Env:
- `backend/.env` — see `.env.example`. Requires `DATABASE_URL`. Optional
  `FRONTEND_URL` (default `http://localhost:5173`) and `PORT` (default `4000`).
- `frontend/.env.local` — `VITE_API_URL` and `VITE_TRPC_URL` (default to
  `http://localhost:4000` and `…/trpc`).

## Architecture — Big Picture

### API surface

The vast majority of the API is **tRPC** mounted at `/trpc/*`. Routers live in
`backend/src/features/*/router.ts` and are composed in `src/trpc/router.ts`
(`appRouter`). The frontend consumes them via `src/lib/trpc.ts`, which exports
both the raw `trpcClient` and a `trpc` proxy from
`@trpc/tanstack-react-query` for use with TanStack Query (`useQuery`,
`useMutation`).

Plain Express routes are reserved for things tRPC can't do well (multipart
uploads, health checks, third-party webhooks). Route registration lives in
`backend/src/index.ts`. CORS is locked to `env.FRONTEND_URL` with
`credentials: true`.

### Database

`backend/src/db/index.ts` exports:
- `ownerPool` — `pg.Pool` (node-postgres, TCP) against `DATABASE_URL`.
- `db` — drizzle on `ownerPool` via `drizzle-orm/node-postgres`. App-table
  reads/writes go here.

The tRPC context (`src/trpc/context.ts`) injects `db` into every procedure as
`ctx.db`. Service code should accept `ctx` and pass `ctx.db` down to the
feature `repo.ts`.

### Frontend structure (`frontend/src/`)

- `main.tsx` — wraps `App` in `QueryClientProvider` (from
  `lib/trpc.ts`).
- `App.tsx` — root component.
- `components/ui/` — Shadcn primitives. Managed via the `shadcn` CLI;
  `components.json` lives at the frontend root (style: `new-york`, base color
  neutral, alias `@` → `src/`).
- `components/` — feature components.
- `lib/utils.ts` — `cn()` helper (clsx + tailwind-merge).
- `lib/trpc.ts` — tRPC client, the shared `QueryClient`, and the `trpc`
  proxy. Imports `AppRouter` directly from `../../backend/src/trpc/router`
  for end-to-end type safety (no codegen).
- `hooks/` — custom React hooks.
- `index.css` — Tailwind v4 entry. Defines the Shadcn OKLCH design tokens
  (`--background`, `--foreground`, `--primary`, …) for light and dark, then
  exposes them to Tailwind via `@theme inline`.

### Backend structure (`backend/src/`)

- `features/<name>/` — each feature is `schema.ts` (Drizzle), `repo.ts` (data
  access, takes the `db` handle), `service.ts` (business logic, takes
  `Context`), `router.ts` (tRPC procedures).
- `db/index.ts` — Neon pool + drizzle handle
- `db/schema.ts` — re-exports all feature schemas (drizzle-kit reads this)
- `db/migrate.ts` — applies migrations from `drizzle/`
- `trpc/` — `context.ts`, `trpc.ts` (procedure builders), `router.ts`
  (composes feature routers into `appRouter`; exports `AppRouter` type)
- `lib/env.ts` — zod-validated env

## Conventions

- **ESM with `.js` extensions** — backend uses `"type": "module"`; relative
  imports in `.ts` source must end in `.js` (e.g.
  `import * as repo from "./repo.js"`). Preserve when adding files.
- **Path alias `@/`** on the frontend → `frontend/src/`. Configured in both
  `tsconfig.app.json` (for tsc / editor) and `vite.config.ts` (for the
  bundler).
- **superjson** is the tRPC transformer on both sides. Match it on any new
  link or procedure config.
- **Drizzle migrations**: edit `features/*/schema.ts`, run
  `npm run db:generate` to produce a new SQL file in `drizzle/`, then
  `npm run db:migrate`. Don't hand-edit generated migrations.
- **Tailwind v4** is wired via `@tailwindcss/vite` (no `tailwind.config.ts`).
  Design tokens live in `src/index.css` under `:root` / `.dark` and are
  exposed to Tailwind via `@theme inline`. Shadcn components live in
  `components/ui/` and are managed via the `shadcn` CLI.
- **End-to-end types**: the frontend imports `AppRouter` from
  `../../backend/src/trpc/router`. Don't break that import path or wrap it in
  an extra package.

## Features

Document substantial features here.

**Keep this section current.** When you build a substantial new feature or
make a meaningful change to an existing one (new flow, new entry point,
changed visibility/auth model, removed surface), update the matching
subsection below in the same PR. Small fixes and refactors don't need an
edit. If a feature listed here is removed, delete its subsection rather than
leaving a stale entry.

### Slice 2 — Resilient Clay enrichment

`enrichment_jobs` (one row per candidate, `UNIQUE(candidate_id)`) is the
queue — no external queue library. The state machine is
`queued → dispatched → done | failed`. Three concerns share one feature
folder (`features/candidates/`):

- **Dispatcher** (`worker.ts:dispatcherPass`) — every 3s tick, atomically
  claims one due `queued` row via `UPDATE … FOR UPDATE SKIP LOCKED`, POSTs to
  Clay with `AbortController` timeout, and is **fire-and-forget at 2xx**
  (leaves the row `dispatched`, awaiting Clay's callback). Errors get typed
  codes (`network` / `timeout` / `http_429` / `http_5xx` / `http_4xx` /
  `config`); transient ones go back to `queued` with exp backoff
  (`[5s, 30s, 2m, 10m, 1h]` ±20% jitter) until `ENRICH_MAX_ATTEMPTS`, then
  `failed`. 429 honors `Retry-After` and sets an in-memory global gate that
  pauses subsequent dispatches.
- **Sweeper** (`worker.ts:sweeperPass`) — same tick. One SQL `UPDATE` finds
  `dispatched` rows older than `ENRICH_CALLBACK_TIMEOUT_SECONDS` and either
  re-queues (if budget remains) or marks `failed`. This is the safety net for
  callbacks that never arrive.
- **Receiver** (`callback.ts`, `POST /api/webhooks/clay`) — already in place
  from slice 1. Verifies `x-callback-secret`, matches by normalized
  `linkedin_url`, writes enrichment, flips the job to `done` in one tx. Late
  callback on a `failed` row is accepted and logged loudly.

A `CLAY_MOCK_MODE` env-gated provider (`clay-mock.ts`) deterministically
exercises every bucket (200 / 429 / 500 / never-respond) via a hash of
`candidate_id` so failure modes can be demoed without burning Clay credits.

Frontend (`candidates-table.tsx`) shows the `failed` badge, attempt counts,
next-retry time, and a "Retry failed (N)" button.

**Env vars** (all optional, defaults shown):
- `CLAY_MOCK_MODE` — any truthy value routes dispatch to `clay-mock.ts`.
- `ENRICH_MAX_ATTEMPTS=5`
- `ENRICH_CALLBACK_TIMEOUT_SECONDS=900` — sweeper threshold.
- `ENRICH_WORKER_INTERVAL_MS=3000` — worker tick interval.
- `ENRICH_DISPATCH_TIMEOUT_MS=30000` — `AbortController` timeout on the POST.

### Slice 3 — Faceted profile extraction + embedding

Foundation for the multi-stage ranker (Stage 0 hard filters → Stage 1
embedding recall → Stage 2 cheap-LLM score → Stage 3 strong-LLM rerank).
This slice only ships step 1 (extract) and step 2 (embed) — no ranking,
no role rubric, no retrieval queries.

When a Clay callback flips an enrichment job to `done`, the same tx queues
a `profile_jobs` row. The profile worker drives a second state machine on
`profile_jobs`:

- **Extract** (`openai.ts:extractProfile`) — calls `OPENAI_EXTRACTION_MODEL`
  (default `gpt-5-mini`) with `response_format: { type: "json_schema", strict: true }`
  against `profile-schema.ts`'s closed-enum facets (seniority_band /
  stack_orientation / company_stage_exposure / b2b_b2c / tenure_pattern /
  archetype / track) plus open-vocab `industries`, `years_experience`,
  `key_skills`, and a 1-3 sentence `summary`. The schema is **role-agnostic
  by design** — the rubric is layered on at rank time, not bound here. The
  caller server-side overrides `extraction_meta` (model, prompt_version,
  timestamps, token counts) so the model can't lie about itself.
- **Embed** (`openai.ts:embedProfile`) — feeds the output of
  `profile-builder.ts:buildEmbeddingInput` (facets + summary + top recent
  titles, role-agnostic) into `OPENAI_EMBEDDING_MODEL` (default
  `text-embedding-3-large`, 3072 dims). `markDoneWithProfile` commits the
  jsonb profile, the pgvector literal, the embedding-input text, and the
  job=done flip atomically.
- **Retry** — `worker.ts`-style state machine: `[5s, 30s, 2m, 10m, 1h]`
  ±20% jitter, capped at `PROFILE_MAX_ATTEMPTS`. Error taxonomy:
  `openai_429 | openai_5xx | openai_4xx | network | timeout |
  validation_failed | config | no_enrichment`. `openai_4xx`, `config`,
  `validation_failed`, and `no_enrichment` are permanent; the rest
  backoff-retry. `openai_429` sets an in-memory gate independent of Clay's.

**No sweeper** — the worker drives both API calls inline, no external
callback to time out on. **No pgvector index** in this slice — vectors are
written but not queried; HNSW/IVFFlat lands in slice 4 with retrieval.

`pgvector` is enabled by `CREATE EXTENSION IF NOT EXISTS vector;` prepended
to `drizzle/0003_*.sql`. Drizzle Kit does not emit extension statements, so
new vector-using migrations need the same manual prepend.

On boot, `backfillMissingProfileJobs` queues a profile job for every
candidate that has enrichment but no existing profile job — idempotent.

Frontend (`candidates-table.tsx`) has a new Profile column rendering
seniority/stack/archetype/track badges, an "extracting…" pill while the
job is in-flight, and a red error-code chip on failure. Expanded row
shows enrichment + profile JSON side-by-side.

**Env vars** (all optional, defaults shown):
- `OPENAI_API_KEY` — when unset the worker fails every job with code
  `config`. The rest of the backend boots normally.
- `OPENAI_EXTRACTION_MODEL=gpt-5-mini`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-large`
- `OPENAI_TIMEOUT_MS=30000`
- `PROFILE_WORKER_INTERVAL_MS=5000`
- `PROFILE_WORKER_CONCURRENCY=20`
- `PROFILE_MAX_ATTEMPTS=5`
