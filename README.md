# Beluga Assessment

LinkedIn-candidate ranker. Upload a CSV → enrich via Clay → distill each
candidate into a faceted profile + embedding → paste a job description and
see candidates ranked by semantic match with a color-coded fit category and
an LLM-generated one-liner per candidate.

Two independent npm projects, run side-by-side:

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + Shadcn + tRPC v11
  + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev) + tRPC v11 + Drizzle
  on Neon Postgres (pgvector) + OpenAI. Port **4000**.

Architecture, conventions, and feature anatomy live in `CLAUDE.md`. Slice
plans + decision snapshots live in `mission-docs/`.

## Quick start

```bash
# backend
cd backend
cp .env.example .env   # DATABASE_URL, OPENAI_API_KEY, (Clay vars optional)
npm install
npm run db:migrate
npm run dev

# frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Hit http://localhost:5173.

## What's built

The project landed in four slices. Each adds a layer on top of the previous one.

### Slice 1 — Clay enrichment

CSV upload → candidates persisted with `linkedin_url` upsert → each pending
row POSTed to a Clay table's webhook → Clay calls back at
`/api/webhooks/clay` (`x-callback-secret`-gated) → enrichment matched by
normalized URL, stored as JSONB. The UI is a single page: upload card +
candidates table with status badge and expandable raw enrichment.

### Slice 2 — Resilience

Dispatch lifecycle moves into an `enrichment_jobs` queue
(`queued → dispatched → done | failed`) driven by an in-process worker. A
3s tick claims due rows with `FOR UPDATE SKIP LOCKED` and fans dispatches
out concurrently. Transient failures get typed error codes
(`http_429 | http_5xx | network | timeout | …`) and retry with exponential
backoff + jitter, with an in-memory rate-limit gate honoring Clay's
`Retry-After`. A **sweeper** in the same tick recovers `dispatched` rows
whose callback never arrives. A `CLAY_MOCK_MODE` provider deterministically
hits every failure bucket so demos work without Clay credits. UI gains
failed badges, attempt counts, next-retry timestamps, and a
"Retry failed (N)" button.

### Slice 3 — Faceted profile + embedding

When a candidate's enrichment lands, a second worker calls OpenAI
(`gpt-5.4-2026-03-05`) with strict JSON-schema structured outputs to distill
the raw enrichment into a **role-agnostic** fixed-vocab profile (seniority
band, stack orientation, archetype, track, industries, B2B/B2C, plus a
normalized `recent_role_title` and `recent_role_responsibilities` aggregated
from every prior role of the same craft). The profile is then formatted as a
`key=value` text block — JSON syntax stripped, full experience / education /
projects pulled from the raw enrichment — and embedded via
`text-embedding-3-large` (3072 dims) into pgvector. Same worker pattern as
slice 2: retries, error taxonomy, 429 gate. The candidates table shows
facet badges per row.

### Slice 4 — JD ranking

Paste a job description into the ranker card. The backend extracts a parallel
`jobProfileSchema` (reuses the slice-3 enum vocab so embeddings overlap),
embeds it in the same 3072-dim space, then ranks candidates by cosine
similarity via pgvector's `<=>`. For the top 50, `gpt-5-mini` is called once
per candidate to return `{ category, explanation }` — categories are
**Strong / Good / Low / Irrelevant**, the explanation is a ≤15-word fit
sentence citing a specific skill or role-craft match. The prompt is laid out
so the JD-side content is the byte-identical leading prefix across the
batch — OpenAI's auto-prompt-cache picks this up and we log per-call
cached-token counts plus a batch cache-rate %. UI is a sortable table:
color-coded match chip (green / yellow / orange / red), similarity %, and
the one-liner.

## Why a custom worker, not pg-boss

Honestly: **the take-home timebox.** Writing the ~120-LoC worker
(`features/candidates/worker.ts`) was the fastest path to a demonstrable
queue + retry + sweeper + DLQ — `pg-boss` and `graphile-worker` would have
spent half the budget on integration before producing visible behavior.

**For production I'd swap to `pg-boss`** (or `graphile-worker`). Both handle
retry math, delayed jobs, fairness, multi-process workers, and a DLQ table
out of the box. The hand-rolled version reads clearly when graders walk it,
but it's not what I'd want running long-term.

Two pieces of context that make the custom version OK at this scope:

- **Shape mismatch.** Clay is fire-and-forget with an async callback; a
  pg-boss job is run-to-completion. Modeling Clay needs a two-stage job
  (dispatch + a separate callback-deadline scheduled after) — solvable, but
  not free.
- **Volume.** ~50-100 candidates is below the line where the library's hard
  problems (fairness, partitioning, multi-process scaling) actually pay off.

Switch threshold: past ~10k candidates/min, or as soon as we need multiple
worker processes sharing one queue.

## Clay setup

Skip this section if running with `CLAY_MOCK_MODE=1`.

1. Create a Clay table with a **Webhook source** whose columns match the
   fields the backend sends: `candidate_id`, `full_name`, `linkedin_url`,
   `email`. Paste URL + auth into `CLAY_WEBHOOK_URL` / `CLAY_WEBHOOK_AUTH`.
2. Add an **"Enrich Person from LinkedIn URL"** column (or the waterfall of
   your choice).
3. Add an **"HTTP API" column** POSTing back to your tunneled
   `/api/webhooks/clay` with header `x-callback-secret: <CLAY_CALLBACK_SECRET>`
   and body `{ "linkedin_url": "<chip>", "enrichment_json": { ... } }`.
   Include at least `headline` inside `enrichment_json` so the UI table has
   something to show.
4. Expose the backend via `ngrok http 4000` (or cloudflared).
5. Run a small batch first — the Clay trial is ~1k credits.

## Env

Required: `DATABASE_URL` (Neon Postgres with pgvector), `OPENAI_API_KEY`.

Full schema with defaults: `backend/src/lib/env.ts`. The useful knobs:

| Var | Default | What it does |
| --- | --- | --- |
| `CLAY_MOCK_MODE` | unset | Truthy → use the deterministic mock provider (70% ok / 10% 429 / 10% 500 / 10% never-respond). Skips Clay credits. |
| `OPENAI_EXTRACTION_MODEL` | `gpt-5.4-2026-03-05` | Used by the candidate-profile and JD extractors (structured outputs). |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-large` | 3072-dim. Same model embeds candidates and JDs so cosine sim is meaningful. |
| `OPENAI_EXPLAIN_MODEL` | `gpt-5-mini` | Per-candidate match explainer + category. |
| `ENRICH_*`, `PROFILE_*` | see env.ts | Worker tick interval, concurrency, retry budget, callback-timeout threshold. |

## With another week

- **Stage 0 hard filters.** Drop candidates below required-years or missing a
  must-have skill before any LLM call — saves the explainer's token budget
  for candidates who could plausibly fit.
- **Stage 3 strong-model re-ranker.** Top 10-15 from the current pipeline go
  to a stronger model (`gpt-5.4` or `claude-opus`) for fine-grained ordering
  and polished reasoning. Spend tokens only where they earn signal.
- **Streamed explanations.** UI populates each row's one-liner as it returns
  instead of waiting for the whole batch — per-candidate mutation or SSE.
- **DB-cached explanations** keyed by `(jobId, candidateId, prompt_version)`
  so re-viewing a JD's matches doesn't re-burn tokens. Deliberately deferred
  in slice 4 step 2.
- **pgvector HNSW index** on `candidates.profile_embedding` once the corpus
  passes a few thousand rows — exact cosine sim is fast at 100-row scale but
  doesn't stay flat.
- **LISTEN/NOTIFY** for both workers, replacing 3s/5s polling with
  event-driven wake-ups — pushes enrichment + profile-extraction latency
  closer to zero between ticks.
- **Per-row retry button** in the UI alongside the existing batch
  "Retry failed (N)".

