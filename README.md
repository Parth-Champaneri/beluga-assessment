# Beluga Assessment

Demo video: https://youtu.be/zpEhc-URBD0

LinkedIn-candidate ranker. Upload a CSV → enrich via Clay → distill each
candidate into a faceted profile + embedding → paste a job description and
see candidates ranked by semantic match with a color-coded fit category and
an LLM-generated one-liner per candidate.

Two independent npm projects, run side-by-side:

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + Shadcn + tRPC v11
  + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev) + tRPC v11 + Drizzle
  on Neon Postgres (pgvector) + OpenAI. Port **4000**.

Architecture and conventions live in `CLAUDE.md`. `mission-docs/` holds
plan snapshots and `changelog.md` — the changelog is updated on every
functional change as a CLAUDE.md project discipline, so it reflects the
actual build order rather than a written-after-the-fact summary.

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

### Phase 1 — Clay enrichment

- Upload CSV of candidates
- Backend POSTs each to a Clay webhook
- Clay POSTs the enriched row back; stored as JSONB
- UI: candidates table with status badge + raw enrichment

### Phase 2 — Resilience

- `enrichment_jobs` queue: `queued → dispatched → done | failed`
- Worker tick retries transient errors with exponential backoff + jitter
- Sweeper recovers `dispatched` rows whose callback never arrives
- Honors Clay's 429 `Retry-After`
- `CLAY_MOCK_MODE` for credit-free demos (hits every failure bucket)
- UI: failed badges, attempt counts, "Retry failed (N)" button

### Phase 3 — Faceted profile + embedding

- LLM distills raw enrichment into a fixed-vocab profile (seniority, stack,
  archetype, track, industries, B2B/B2C, normalized recent role + same-craft
  responsibilities)
- Profile serialized as `key=value` text, embedded with
  `text-embedding-3-large` (3072 dims), stored in pgvector
- Same worker pattern as Phase 2 (queue, retries, 429 gate)
- UI: facet badges per row

### Phase 4 — JD ranking

- Paste a JD; backend extracts a parallel `jobProfileSchema` and embeds it
  into the same 3072-dim space
- Cosine similarity (pgvector `<=>`) ranks candidates
- `gpt-5-mini` writes a ≤15-word fit sentence + category per top-50
  candidate (**Strong / Good / Low / Irrelevant**)
- Prompt laid out so the JD content auto-caches across the batch — logs
  per-call cached-token count + batch cache-rate %
- UI: sortable table — color-coded match chip, similarity %, one-liner

## Trade-offs

### Custom worker

- **Why hand-rolled.**  In a take-home timebox. The whole queue +
  retry + sweeper + DLQ (`features/candidates/worker.ts`) is ~120 LoC —
  small enough that configuring an off-the-shelf queue library and learning
  its conventions would have taken longer than writing it.
- **Production swap.** An off-the-shelf queue library handles retry math,
  delayed jobs, fairness, and multi-process workers out of the box — what
  I'd run long-term.

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

Ordered most → least impactful for this system.

- **Second pass on candidate extraction + storage.** Foundation — every
  downstream stage (embedding, facet filtering, explainer) reads from this.
  Slice 3 shipped the vocab fast to get the pipeline end-to-end; we're not
  pulling everything out of the enrichment payload, several facet enums are
  coarser than they should be, and the JSONB shape candidates land in would
  benefit from a deliberate revisit. Pure time-constraint, not a deliberate
  design choice.
- **Strong-model re-ranker.** Take only the Strong and Good match buckets
  and run them through a stronger model (`gpt-5.4` or `claude-opus`) for
  fine-grained ordering and polished reasoning. Spend tokens only where
  they earn signal — and this is the part users look at first.
- **Hard filters for candidates.** Drop candidates below required-years or
  missing a must-have skill before any LLM call — cleaner top-50 going into
  the explainer, fewer tokens wasted on obvious misses.
- **Eval calibration harness.** Small fixture set + scoring for the
  extractor and explainer prompts so prompt-version regressions show up
  before they ship. Protects the three items above from silent erosion.
- **DB-cached explanations** keyed by `(jobId, candidateId, prompt_version)`
  so re-viewing a JD's matches doesn't re-burn tokens. Deliberately deferred
  in slice 4 step 2.
- **Cost dashboard.** Token counts already persist in
  `profile_extraction_meta`; next step is summing per JD / per day in the
  UI. For now I read costs from the OpenAI dashboard.
- **Clay trigger on `candidate_id` too.** App-layer dedupe already exists
  (unique constraint on `enrichment_jobs.candidate_id`); configuring Clay's
  HTTP API column to fire on `candidate_id` change instead of just
  `linkedin_url` would add a second idempotency layer at the source. Knock-on:
  the callback could match by primary key instead of the `linkedin_url`
  unique index.

