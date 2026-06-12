# Changelog

Functional changes, newest on top. Keep entries short — one-sentence request,
1–3 bullet changes. See `CLAUDE.md` for the rule.

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
