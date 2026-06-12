# Changelog

Functional changes, newest on top. Keep entries short — one-sentence request,
1–3 bullet changes. See `CLAUDE.md` for the rule.

---

## 2026-06-12 — slice-2 docs (plan snapshot + README resilience)
**Request:** Land slice-2 documentation so the pg-boss decision and new env vars survive.
**Changes:**
- mission-docs/plans/2026-06-12-slice-2-resilient-enrichment.md — plan snapshot.
- CLAUDE.md Features: dispatcher + sweeper + receiver model for slice 2.
- README: Resilience section (pg-boss eval + cut threshold, env vars, "with another week").

---

## 2026-06-12 — resilient worker + mock Clay + retry UI (slice-2)
**Request:** Slice-2 hardening — retries, timeouts, rate limits, idempotency, DLQ.
**Changes:**
- clay.ts: AbortController timeout + typed DispatchResult; categorized error codes (network | timeout | http_429 | http_5xx | http_4xx | config). Honors Retry-After.
- Mock Clay (CLAY_MOCK_MODE) with 70/10/10/10 ok/429/500/timeout buckets and delayed synthetic callbacks — credit-free demos.
- Background worker (3s tick): atomic claim + exp backoff retries + in-memory 429 gate; sweeper recovers stuck dispatched rows or DLQs after ENRICH_MAX_ATTEMPTS. enrichAll mutation renamed to nudgeQueued (alias kept).
- retryFailed mutation + UI: failed badge, attempts/next-retry display, "Retry failed (N)" button.

---

## 2026-06-12 — enrichment_jobs table + state refactor (slice-2 prep)
**Request:** Slice-2 prep — extract dispatch lifecycle from candidates into a jobs table.
**Changes:**
- New enrichment_jobs table (queued | dispatched | done | failed) with attempt_count, next_attempt_at, dispatched_at, last_error_*. candidates slimmed to person + enrichment.
- Repo/service refactor: list / upsert / enrichAll / applyCallback flow through jobs-repo; frontend gets a merged row shape via the existing list query. Sync dispatch loop preserved — worker lands in slice-2 Phase B.

---

## 2026-06-12 — Match callbacks by `linkedin_url` instead of `candidate_id`
**Request:** Stop wrestling with UUID chips in the Clay body — match on linkedin_url (unique already).
**Changes:**
- Callback now expects `{ linkedin_url, enrichment_json }`; URL gets normalized server-side, candidate looked up by `linkedin_url`. Errors become `400 unrecognizable linkedin_url` and `404 unknown linkedin_url`. Logs key off the URL.
- `repo.saveEnrichmentByLinkedinUrl` replaces `saveEnrichment` (`WHERE linkedin_url = ?`).
- Dispatch payload to Clay still includes `candidate_id` (harmless extra column) — only the inbound contract changed.

---

## 2026-06-12 — Callback contract: wrap enrichment in `enrichment_json`
**Request:** Cleaner shape — Clay sends `{ candidate_id, enrichment_json: {...} }` instead of spreading enrichment fields at the top level; backend stores `enrichment_json` verbatim.
**Changes:**
- `callback.ts` zod schema now requires `candidate_id` + `enrichment_json` (`z.unknown()`); the rest of the body is ignored. Stored as the candidate's `enrichment` jsonb unchanged.
- `summarizeEnrichment` log helper reads `headline` from inside `enrichment_json`.
- README Clay-setup section updated to the new body shape.

---

## 2026-06-12 — Enrichment observability
**Request:** Easier to tell whether a Clay enrichment worked — proper logs and surface per-candidate failures.
**Changes:**
- `candidates.last_dispatch_error` text column (migration `0001_funny_scarlet_spider.sql`); cleared on successful re-send, set on failure.
- Backend logs at every edge: `[enrich] → sending`/`✓ sent`/`✗ failed`, `[clay] → ack ...ms`/`✗ HTTP ...`/`✗ network`, `[clay-callback] ← received candidate=... headline="..."`/`401 bad secret`/`404 unknown`/`500 error`.
- UI: failure list under the Enrich button (first 5 + overflow); ⚠ on rows whose last dispatch failed, with full error shown in the expanded row.

---

## 2026-06-12 — Switch runtime DB driver from `@neondatabase/serverless` to `pg`
**Request:** Runtime queries failed with "All attempts to open a WebSocket… fetch failed". Use drizzle out of the box.
**Changes:**
- `db/index.ts` now uses `pg.Pool` + `drizzle-orm/node-postgres` (plain TCP) — same path drizzle-kit's migrate already used successfully. Removed `@neondatabase/serverless` dep, added `pg` + `@types/pg`.
- CLAUDE.md updated to reflect the driver.

---

## 2026-06-12 — Env loading + use drizzle-kit's built-in migrate
**Request:** `npm run db:migrate` failed — `tsx` didn't load `.env`, and the custom migrate script duplicates what drizzle-kit ships.
**Changes:**
- `dev`/`start`/`db:migrate` pass `--env-file=.env` (Node 20 native); `drizzle.config.ts` calls `process.loadEnvFile()` for `db:generate`/`db:studio`.
- Replaced `src/db/migrate.ts` + `tsx` script with `drizzle-kit migrate`. README quickstart unchanged (`npm run db:migrate` still works).

---

## 2026-06-12 — Snapshot slice-1 plan into mission-docs
**Request:** Drop the approved plan that drove steps 1–4 into the repo so it's part of the project record.
**Changes:**
- Added `mission-docs/plans/2026-06-12-slice-1-clay-enrichment.md`.

---

## 2026-06-12 — Clay dispatch + webhook callback + Enrich button
**Request:** Step 4 — send pending candidates to Clay, receive the enriched row back, persist it; Enrich button in the UI.
**Changes:**
- `candidates/clay.ts` POSTs `{candidate_id, full_name, linkedin_url, email}` to `CLAY_WEBHOOK_URL` with `x-clay-webhook-auth`. `service.enrichAll` walks `pending`, dispatches with a ~300ms gap, marks `sent`; failures stay `pending` and surface in the response. Exposed as `candidates.enrichAll` mutation.
- `candidates/callback.ts` plain Express route `POST /api/webhooks/clay` (own `express.json()`), `x-callback-secret` check, zod-validates `candidate_id`, persists the rest of the body as the enrichment JSON and flips status to `enriched`. Mounted in `index.ts` before tRPC.
- Env vars: `CLAY_WEBHOOK_URL`/`CLAY_WEBHOOK_AUTH` (optional, required only at enrichment time), `CLAY_CALLBACK_SECRET` (defaults to `dev-secret`). README gained a Clay table setup section.

---

## 2026-06-12 — UI: CSV upload + candidates table
**Request:** Step 3 — single page to upload a CSV and see the candidates that landed.
**Changes:**
- New `components/csv-upload.tsx` (file input → `file.text()` → `ingestCsv` mutation, shows added/existed/skipped summary) and `components/candidates-table.tsx` (Name / LinkedIn / Email / Status badge / Headline, row click expands raw enrichment JSON, polls every 2s while any row is `sent`).
- Rewrote `App.tsx` as a single page composing both.
- Added Shadcn `table`, `badge`, `card`.

---

## 2026-06-12 — CSV ingest API
**Request:** Step 2 — `ingestCsv` and `list` tRPC procedures so a CSV of candidates can be uploaded.
**Changes:**
- `candidates/{repo,service,router}.ts`: papaparse CSV with header tolerance, LinkedIn URL normalization, upsert keyed on `linkedin_url` (idempotent re-ingest), returns `{inserted, updated, errors[]}`.
- CSV is sent as a string through tRPC (≪ 1MB at this scale) rather than a multipart Express route — deliberate deviation from CLAUDE.md's "Express for uploads" note.
- Added `papaparse` dep.

---

## 2026-06-12 — Candidates schema + first migration
**Request:** Step 1 of the Clay enrichment slice — candidates table, drop the example feature.
**Changes:**
- Added `features/candidates/` with `schema.ts` (id, full_name, linkedin_url unique, email, status, enrichment jsonb, sent_at, enriched_at, created_at).
- Deleted `features/example/`; `appRouter` now empty. Generated first migration in `drizzle/`.
- Pointed `drizzle.config.ts` `schema` at the `features/*/schema.ts` glob so drizzle-kit doesn't trip on ESM `.js` extensions in the barrel.

---

## 2026-06-10 — Slim down changelog format
**Request:** Make the changelog and its CLAUDE.md rule much more concise; simplify existing entries and tell future entries to stay simple.
**Changes:**
- Rewrote `CLAUDE.md` § Changelog discipline as a short template + "keep it bare-bones" rule.
- Condensed existing entries in this file.

---

## 2026-06-10 — Add `mission-docs/` + changelog system
**Request:** Add a mission-docs folder with a mission statement and a changelog, and make CLAUDE.md require a changelog entry per functional change.
**Changes:**
- Added `mission-docs/mission.md` (skeleton) and `mission-docs/changelog.md`.
- Added § Changelog discipline to `CLAUDE.md`.

---

## 2026-06-10 — Initial monorepo scaffolding
**Request:** Init git + private GitHub repo and scaffold `frontend/` + `backend/` matching the DataDive stack (Shadcn, TanStack Query, tRPC, Drizzle, Neon), no auth, Vite instead of Next.js.
**Changes:**
- `backend/` — Express + tRPC v11 + Drizzle + Neon, ESM/tsx, port 4000, with an `example` feature slice proving the wiring.
- `frontend/` — Vite + React 19 + Tailwind v4 + Shadcn (new-york/neutral) + tRPC + TanStack Query, port 5173, `AppRouter` imported directly from the backend.
- Root: `.gitignore`, `README.md`, `CLAUDE.md`.
