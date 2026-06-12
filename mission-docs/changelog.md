# Changelog

Functional changes, newest on top. Keep entries short — one-sentence request,
1–3 bullet changes. See `CLAUDE.md` for the rule.

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
