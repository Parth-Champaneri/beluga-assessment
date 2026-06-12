# Slice 1 — Single-run Clay enrichment (executed 2026-06-12)

Snapshot of the plan that was approved and executed. Source plan file:
`~/.claude/plans/imperative-strolling-spark.md`.

## Context

Take-home requires enriching LinkedIn candidates via Clay. **This slice is the happy path only**: upload a small CSV (full_name, linkedin_url, email?) through a simple page, see the candidates in a table, press Enrich to send them to Clay, receive Clay's callback, save and display the enrichment JSON. No queue, no retries, no DLQ, no worker — that resilience layer is a later slice, layered on top of this once a single run works end-to-end.

Clay mechanics (verified): POST a JSON row to the Clay table's webhook URL (`x-clay-webhook-auth` header; 2xx ack only). A final "HTTP API" column in the Clay table POSTs the enriched row back to our callback URL — we control its body template, so we echo `candidate_id` through for correlation. Local dev needs a public tunnel (ngrok/cloudflared) for that callback.

## Schema

`backend/src/features/candidates/schema.ts` — one table:

- `candidates`: id (uuid PK), full_name (text), linkedin_url (text, **unique**, normalized: lowercase host+path, strip query/trailing slash), email (text, nullable), status (text: `pending | sent | enriched`, default `pending`), enrichment (jsonb, nullable), sent_at, enriched_at, created_at.

Correlation id = candidate id. The unique linkedin_url makes re-ingest a no-op (cheap idempotency for free — worth having even in the happy path so a double upload doesn't double-send to Clay later).

No jobs table yet. When we build the queue slice, `status` bookkeeping moves into an `enrichment_jobs` table; this slice keeps it inline.

## Backend pieces (all in `features/candidates/`, following the example-slice pattern)

1. **`schema.ts`** — table above. Re-export from `db/schema.ts`. Delete the `example` feature (schema, folder, router wiring; frontend usage replaced in the optional UI phase). First migration via `npm run db:generate` + `db:migrate`.

2. **`repo.ts`** — `upsertCandidates(db, rows)` (onConflictDoUpdate on linkedin_url), `listCandidates(db)`, `markSent(db, ids)`, `saveEnrichment(db, candidateId, payload)` (sets status=enriched, enriched_at; `WHERE id=$1` — a duplicate callback just overwrites with the same data, fine for now).

3. **`service.ts`** —
   - `ingestCsv(ctx, { csvText })`: parse with papaparse, validate headers, normalize linkedin_url, upsert; returns `{inserted, updated, errors[]}`.
   - `enrichAll(ctx)`: select candidates with status=`pending`, for each `fetch` POST to `env.CLAY_WEBHOOK_URL` with header `x-clay-webhook-auth: env.CLAY_WEBHOOK_AUTH`, body `{ candidate_id, full_name, linkedin_url, email }`; on 2xx mark `sent`. Sequential loop with a ~300ms gap (politeness, not a real rate limiter). Non-2xx: record nothing, log, leave `pending` (re-running enrichAll retries it — that's the whole error story for this slice).

4. **`router.ts`** — tRPC: `ingestCsv` mutation (`{ csvText: z.string().max(1_000_000) }`), `enrichAll` mutation, `list` query. Wire into `trpc/router.ts`.

5. **`callback.ts`** — plain Express router mounted in `index.ts` *before* tRPC: `POST /api/webhooks/clay` with its own `express.json()`. Checks `x-callback-secret === env.CLAY_CALLBACK_SECRET`, zod-parses `{ candidate_id, ...payload }`, calls `saveEnrichment`. 200 on success, 401 bad secret, 404 unknown candidate.

6. **`lib/env.ts`** — add `CLAY_WEBHOOK_URL`, `CLAY_WEBHOOK_AUTH`, `CLAY_CALLBACK_SECRET`.

New dep: `papaparse` (+ `@types/papaparse`). CSV travels as text through tRPC (~100 rows ≪ 1MB) — simpler than a multipart route; noted as a deliberate choice in the changelog.

## Manual setup (user does this — only they can)

1. In Clay UI: create table with **Webhook source** (fields: candidate_id, full_name, linkedin_url, email) → **"Enrich Person from LinkedIn URL"** column → final **HTTP API column**: POST to `https://<tunnel>/api/webhooks/clay`, header `x-callback-secret: <secret>`, body template echoing `{{candidate_id}}` plus the enriched fields (headline, location, experiences, education, …).
2. Run `ngrok http 4000` (or cloudflared) and paste the tunnel URL into that HTTP API column.
3. Put webhook URL + auth token + chosen callback secret into `backend/.env`.

README has a short "Clay table setup" section documenting these steps.

## Frontend (part of this slice — single page in `App.tsx`)

One screen, three zones:

1. **Upload zone** — `components/csv-upload.tsx`: `<input type="file" accept=".csv">` read client-side via `file.text()`, **Submit** button → `ingestCsv` mutation → result line ("8 added, 2 already existed"), invalidates the list query.
2. **Candidates table** — `components/candidates-table.tsx`: columns Name, LinkedIn URL, Email, Status badge (`pending` / `sent` / `enriched`), and once enriched a Headline summary cell. Row click expands a raw enrichment JSON `<pre>` block so we can eyeball exactly what Clay returned. Driven by `useQuery(trpc.candidates.list.queryOptions())` with `refetchInterval: 2000` while any candidate is `sent` (so callbacks appear live without a manual refresh).
3. **Enrich button** — "Enrich pending (N)" → `enrichAll` mutation; disabled while in flight or N=0.

Shadcn additions via CLI: `table`, `badge`, `card` (already had `button`). No router needed — stays a single page.

## Order of work (small commits)

1. **Schema + migration** — candidates table, drop example feature. Verify: `db:studio`, `typecheck`.
2. **CSV ingest API** — repo/service/router for `ingestCsv` + `list`. Verify: ingest 5-row CSV twice via curl → second reports 0 inserted.
3. **UI: upload + table** — upload zone + candidates table against the real backend (status will sit at `pending`). Verify in browser: upload CSV, rows appear; re-upload, no dupes.
4. **Clay dispatch + callback + Enrich button** — `enrichAll`, callback route, env vars, wire the button. Verify (the real test): ngrok up, Clay table built, upload 2–3 real candidates in the browser, hit Enrich, watch badges flip `sent` → `enriched` and inspect the JSON in the expanded row. Then the full ~50-row run.

## Explicitly deferred (next slice)

Jobs table, worker loop, retries/backoff, callback timeout sweeper, DLQ + retry-dead, rate limiting, mock Clay provider, duplicate-callback hardening, per-candidate enrich button. The README/changelog will note this slice is happy-path by design.

## Bookkeeping
- Changelog entry per commit (bare-bones format).
- CLAUDE.md Features subsection when the slice lands.
