# Beluga Assessment

Two independent npm projects in `frontend/` and `backend/`, run side-by-side.

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 + Shadcn/ui + tRPC v11 + TanStack Query. Port **5173**.
- `backend/` — Express + TypeScript (ESM, `tsx` in dev) + tRPC v11 + Drizzle ORM on Neon serverless Postgres. Port **4000**.

See `CLAUDE.md` for detailed architecture, conventions, and commands.

## Quick start

```bash
# backend
cd backend
cp .env.example .env   # fill in DATABASE_URL
npm install
npm run dev

# frontend (in a separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
