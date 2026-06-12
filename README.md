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
npm run db:migrate     # applies drizzle migrations to Neon
npm run dev

# frontend (in a separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Clay enrichment setup

The backend POSTs candidates to a Clay table's webhook URL, and Clay POSTs the
enriched row back to `/api/webhooks/clay`. The table has to be built once in
the Clay UI — Clay has no programmatic API for creating tables or columns.

1. **Create a Clay table** with a Webhook source. The source's columns should
   match the fields the backend sends: `candidate_id`, `full_name`,
   `linkedin_url`, `email`. Copy the webhook URL and auth token into
   `backend/.env` as `CLAY_WEBHOOK_URL` and `CLAY_WEBHOOK_AUTH`.
2. **Add an "Enrich Person from LinkedIn URL"** column (or the waterfall of
   your choice) so each new row gets enriched.
3. **Add an "HTTP API" column** as the final step. Configure it to POST to
   `https://<your-tunnel>/api/webhooks/clay`, with header
   `x-callback-secret: <your-secret>` (matching `CLAY_CALLBACK_SECRET` in
   `backend/.env`). Body must be `{ "linkedin_url": "<LinkedIn URL chip>",
   "enrichment_json": { ...whatever fields you want stored... } }`. The
   backend matches the row by `linkedin_url` (normalized) and persists
   `enrichment_json` verbatim as the candidate's `enrichment` jsonb.
   Include at least `headline` inside `enrichment_json` so the UI table has
   something to show.
4. **Expose your local backend** with ngrok or cloudflared so Clay's HTTP API
   column can reach it: `ngrok http 4000`. Paste the public URL into the HTTP
   API column from step 3.
5. **Run a small batch first** (2–3 candidates) before the full set — the Clay
   trial is ~1,000 credits, so cold runs can chew through your budget fast.

The current slice is happy-path: a candidate that fails to dispatch stays
`pending` and is retried the next time you press Enrich. Resilience (queue,
backoff, DLQ, callback timeouts) is the next slice.
