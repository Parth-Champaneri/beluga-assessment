import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { env } from "./lib/env.js";
import { db } from "./db/index.js";
import { clayCallbackRouter } from "./features/candidates/callback.js";
import { startEnrichmentWorker } from "./features/candidates/worker.js";
import { startProfileWorker } from "./features/candidates/profile-worker.js";
import { backfillMissingProfileJobs } from "./features/candidates/profile-jobs-repo.js";

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(clayCallbackRouter);

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

const server = app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`);
});

const worker = startEnrichmentWorker({ db });
const profileWorker = startProfileWorker({ db });

// Boot-time catch-up: queue profile jobs for any candidate already enriched
// before this slice landed. Idempotent — safe on every boot.
void backfillMissingProfileJobs(db)
  .then((n) => {
    if (n > 0) console.log(`[profile-worker] backfilled ${n} job(s) on boot`);
  })
  .catch((err) => console.error("[profile-worker] backfill error", err));

async function shutdown(signal: string): Promise<void> {
  console.log(`[backend] received ${signal} — shutting down`);
  try {
    await Promise.all([worker.stop(), profileWorker.stop()]);
  } catch (err) {
    console.error("[backend] worker.stop() error", err);
  }
  server.close(() => {
    process.exit(0);
  });
  // Hard-exit safety net if server.close hangs on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
