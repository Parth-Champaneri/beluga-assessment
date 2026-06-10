# Changelog

A running log of functional changes to the Beluga Assessment project, in
reverse-chronological order (newest at the top).

**What goes here:**
- New features, sub-features, or flows.
- Significant architectural decisions (new dependency, new service boundary,
  schema change, auth model change, etc.).
- Removed or deprecated functionality.

**What doesn't:**
- Pure visual / styling tweaks.
- Copy edits.
- Bug fixes that don't change behavior in a user-visible way.
- Refactors that preserve behavior.

Each entry captures (a) what the user asked for, in their own framing, and
(b) what was actually built. The point is to be able to trace the project's
evolution from prompt to result.

---

## 2026-06-10 — Add `mission-docs/` + changelog system

**Request:** Create a new `Mission Docs` folder with a high-level mission
statement and objective, plus a changelog file. Update `CLAUDE.md` so that
every significant/functional change updates the changelog, capturing what the
user specifically asked for. Skip small UI tweaks; log functional features
and meaningful decisions. Backfill this initial setup as the first entry.

**Changes:**
- Created `mission-docs/` at the repo root (lowercase kebab-case to match
  `frontend/` and `backend/`).
- Added `mission-docs/mission.md` — skeleton mission statement, objective,
  guiding principles, and success criteria. Placeholders left for the
  product-specific bits (`mission statement`, `primary user(s)`,
  `core job-to-be-done`, `success criteria`) that depend on product
  direction not yet specified.
- Added `mission-docs/changelog.md` (this file) — entry format and scope
  rules at the top.
- Updated `CLAUDE.md`: new top-level section **Changelog discipline** that
  makes updating `mission-docs/changelog.md` a hard requirement for any
  functional change, with the entry shape spelled out.

---

## 2026-06-10 — Initial monorepo scaffolding

**Request:** Initialize the project directory as a git repo, create a private
GitHub repo and push, and scaffold a frontend + backend in two separate
folders matching the tech stack of an existing project (DataDive). Use the
same stack — Shadcn, TanStack Query, tRPC, Drizzle, Neon Postgres — but skip
authentication for now. Use plain React + Vite for the frontend instead of
Next.js.

**Changes:**
- `git init` on `main`; created private GitHub repo
  `parth-champ/beluga-assessment` and pushed the initial commit.
- `backend/` — Express + tRPC v11 + Drizzle ORM + `@neondatabase/serverless`,
  TypeScript ESM, `tsx` in dev. Port **4000**. Includes:
  - `src/lib/env.ts` — zod-validated env (requires `DATABASE_URL`).
  - `src/db/` — Neon pool, drizzle handle, migration runner.
  - `src/trpc/` — context, procedure builders, `appRouter` composition.
  - `src/features/example/` — `schema / repo / service / router` slice
    demonstrating the per-feature layout, including a `hello` query used to
    verify end-to-end wiring.
  - `drizzle.config.ts`, `tsconfig.json`, `.env.example`.
- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + Shadcn/ui
  (new-york style, neutral base) + tRPC client + TanStack Query. Port
  **5173**. Includes:
  - Path alias `@/` → `src/` wired in both `tsconfig.app.json` and
    `vite.config.ts`.
  - `src/lib/trpc.ts` — `trpcClient`, shared `QueryClient`, and the `trpc`
    proxy from `@trpc/tanstack-react-query`. Imports `AppRouter` directly
    from `../../backend/src/trpc/router` for end-to-end types (no codegen).
  - `src/index.css` — Tailwind v4 entry with the Shadcn OKLCH design tokens
    and a light/dark theme via `:root` / `.dark` plus `@theme inline`.
  - `src/components/ui/button.tsx` — first Shadcn primitive.
  - `src/App.tsx` — calls `example.hello` via tRPC + TanStack Query to prove
    the loop closes.
- Root: `.gitignore`, `README.md`, `CLAUDE.md` adapted from DataDive — same
  layout/commands/conventions structure, with auth, RLS, AI pipeline, and
  Next.js-specific guidance removed.
