# CLAUDE.md

Guidance for Claude Code working in this repository.

## Changelog discipline

`mission-docs/changelog.md` is the canonical log of how this project was
built — prompt by prompt. **For every functional change, append an entry in
the same response that makes the change.** Don't batch and don't defer.

An entry must capture:
1. **Date** — today's date in `YYYY-MM-DD` (top of the entry).
2. **Title** — one-line summary.
3. **Request** — what the user asked for, in their own framing (paraphrase
   is fine; keep the intent and any constraints they specified). If the
   request mentions a tradeoff they chose, include it.
4. **Changes** — what was actually built, at a level that's useful months
   later. Mention new files/folders, new dependencies, new endpoints, schema
   changes, and any non-obvious decisions.

Newest entries go at the top.

**Log:** new features or sub-features, new flows, new endpoints, schema
changes, new dependencies, removed/deprecated surface, architectural
decisions (auth model, transport, hosting, etc.).

**Skip:** pure styling / copy tweaks, refactors that preserve behavior, bug
fixes with no user-visible behavior change, dependency bumps that don't
change behavior.

If you're unsure whether a change qualifies, log it — the cost of an extra
entry is near-zero; the cost of a missing one is losing the project's
history.

The high-level mission and objective live in `mission-docs/mission.md`.
Keep that file in sync when the product direction shifts (new primary user,
new core job-to-be-done, scope changes).

## Repo Layout

Two independent npm projects in `frontend/` and `backend/`, run side-by-side.
There is no root `package.json` — install/run each side separately.

- `frontend/` — Vite + React 19, TypeScript, Tailwind v4, Shadcn/ui, tRPC v11
  client + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev), tRPC v11, Drizzle ORM
  on Neon serverless Postgres. Port **4000**.

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
- `ownerPool` — `@neondatabase/serverless` `Pool` against `DATABASE_URL`.
- `db` — drizzle on `ownerPool`. App-table reads/writes go here.

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
