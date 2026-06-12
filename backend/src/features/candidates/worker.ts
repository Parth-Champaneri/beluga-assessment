import type { Db } from "../../db/index.js";
import { env } from "../../lib/env.js";
import * as jobsRepo from "./jobs-repo.js";
import * as candidatesRepo from "./repo.js";
import { candidates, type EnrichmentJob } from "./schema.js";
import { eq } from "drizzle-orm";
import { dispatchToClay } from "./clay.js";

/**
 * Module-scoped 429 rate-limit gate. Epoch-ms timestamp; while the current
 * time is below this value the dispatcher sits out ticks. The sweeper still
 * runs — only the outbound dispatch is paused.
 */
let rateLimitGateUntil = 0;

/**
 * Exponential backoff with ±20% jitter, in seconds.
 *   attempt 1 → 5s, 2 → 30s, 3 → 2m, 4 → 10m, 5+ → 1h
 */
function backoff(attempt: number): number {
  const schedule = [5, 30, 120, 600, 3600];
  const base = schedule[Math.min(attempt - 1, schedule.length - 1)];
  return base * (0.8 + Math.random() * 0.4);
}

/**
 * Sweeper pass. ONE atomic UPDATE recovers `dispatched` rows whose callback
 * never arrived within ENRICH_CALLBACK_TIMEOUT_SECONDS — re-queues with
 * retry budget, marks failed when exhausted.
 */
export async function sweeperPass(db: Db): Promise<void> {
  const touched = await jobsRepo.sweepStuckDispatched(db, {
    maxAttempts: env.ENRICH_MAX_ATTEMPTS,
    callbackTimeoutSeconds: env.ENRICH_CALLBACK_TIMEOUT_SECONDS,
  });
  if (touched > 0) {
    console.log(`[sweeper] recovered ${touched} rows`);
  }
}

/**
 * Dispatcher pass. Claims up to ENRICH_DISPATCH_CONCURRENCY due jobs and
 * fans them out in parallel via Promise.allSettled. Each per-job result is
 * handled independently (mark dispatched / failed / re-queued).
 */
export async function dispatcherPass(db: Db): Promise<void> {
  // 0. Rate-limit gate. Skip the tick entirely if a recent 429 is still
  //    holding us back.
  if (Date.now() < rateLimitGateUntil) {
    return;
  }

  // 1. Atomic batch claim — flips up to N queued+due rows to dispatched and
  //    bumps their attempt_count. Concurrent ticks/workers are safe via
  //    `FOR UPDATE SKIP LOCKED`.
  const claimed = await jobsRepo.claimDueBatch(
    db,
    env.ENRICH_DISPATCH_CONCURRENCY,
  );
  if (claimed.length === 0) return;

  console.log(`[dispatcher] claimed ${claimed.length} job(s) for dispatch`);

  // 2. Fan out in parallel. allSettled isolates per-job failures so one
  //    exception can't drop the rest of the batch.
  await Promise.allSettled(claimed.map((job) => dispatchOne(db, job)));
}

/**
 * Per-job dispatch: read candidate, POST to Clay, branch on the typed
 * DispatchResult. Pulled out of the loop body so the batch fan-out reads
 * cleanly.
 */
async function dispatchOne(db: Db, claimed: EnrichmentJob): Promise<void> {
  // Read the candidate row (the dispatcher needs name/url/email).
  const candidateRows = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      linkedinUrl: candidates.linkedinUrl,
      email: candidates.email,
    })
    .from(candidates)
    .where(eq(candidates.id, claimed.candidateId))
    .limit(1);
  const candidate = candidateRows[0];
  if (!candidate) {
    // Candidate was deleted out from under us. Mark the orphan job failed.
    await jobsRepo.markFailed(db, claimed.id, {
      code: "config",
      message: "candidate row missing",
    });
    return;
  }

  // Fire the POST.
  const result = await dispatchToClay({
    candidate_id: candidate.id,
    full_name: candidate.fullName,
    linkedin_url: candidate.linkedinUrl,
    email: candidate.email,
  });

  // Branch on the result. Dispatcher's job ends here either way.
  if (result.ok) {
    console.log(`[dispatcher] ✓ dispatched candidate=${candidate.id}`);
    return;
  }

  // Permanent failures: no point retrying.
  if (result.code === "http_4xx" || result.code === "config") {
    await jobsRepo.markFailed(db, claimed.id, {
      code: result.code,
      message: result.message,
    });
    console.error(
      `[dispatcher] ✗ permanent candidate=${candidate.id} code=${result.code}`,
    );
    return;
  }

  // Exhausted: transient but we've already used our budget. claim has
  // already incremented attempt_count, so the post-claim value lives on
  // claimed.attemptCount.
  if (claimed.attemptCount >= env.ENRICH_MAX_ATTEMPTS) {
    await jobsRepo.markFailed(db, claimed.id, {
      code: result.code,
      message: result.message,
    });
    console.error(
      `[dispatcher] ✗ exhausted candidate=${candidate.id} code=${result.code} attempts=${claimed.attemptCount}`,
    );
    return;
  }

  // 429 → honor Retry-After AND set the global gate so other ticks pause.
  // Other in-flight dispatches in this batch continue; the gate only blocks
  // the NEXT tick from claiming new ones.
  if (result.code === "http_429") {
    const retryAfter = result.retryAfterSeconds ?? 30;
    rateLimitGateUntil = Date.now() + retryAfter * 1000;
    const delaySeconds = Math.max(retryAfter, backoff(claimed.attemptCount));
    await jobsRepo.revertToQueued(db, claimed.id, {
      code: result.code,
      message: result.message,
      delaySeconds,
    });
    console.warn(
      `[dispatcher] ⏸ 429 candidate=${candidate.id} gate=${retryAfter}s delay=${delaySeconds.toFixed(1)}s`,
    );
    return;
  }

  // Other transient (network, timeout, 5xx) → backoff schedule.
  const delaySeconds = backoff(claimed.attemptCount);
  await jobsRepo.revertToQueued(db, claimed.id, {
    code: result.code,
    message: result.message,
    delaySeconds,
  });
  console.warn(
    `[dispatcher] ↻ retry candidate=${candidate.id} code=${result.code} attempt=${claimed.attemptCount} delay=${delaySeconds.toFixed(1)}s`,
  );
}

/**
 * Start the enrichment worker loop. Returns `{ stop }` which flips the
 * stopping flag, clears the pending timer, and resolves after the in-flight
 * tick (if any) completes.
 */
export function startEnrichmentWorker({ db }: { db: Db }): {
  stop: () => Promise<void>;
} {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  // candidate enables single-source tracking if we ever care to await.
  // unused for now — referenced for static-analysis silence.
  void candidatesRepo;

  async function tick(): Promise<void> {
    if (stopping) return;
    try {
      await sweeperPass(db);
      await dispatcherPass(db);
    } catch (err) {
      console.error("[worker] tick error", err);
    } finally {
      if (!stopping) {
        timer = setTimeout(() => {
          inflight = tick();
        }, env.ENRICH_WORKER_INTERVAL_MS);
      }
    }
  }

  timer = setTimeout(() => {
    inflight = tick();
  }, 0);

  console.log(
    `[worker] started — interval=${env.ENRICH_WORKER_INTERVAL_MS}ms concurrency=${env.ENRICH_DISPATCH_CONCURRENCY} maxAttempts=${env.ENRICH_MAX_ATTEMPTS}`,
  );

  return {
    stop: async () => {
      stopping = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inflight) {
        try {
          await inflight;
        } catch {
          // tick already logs its own errors; swallow on shutdown.
        }
      }
      console.log("[worker] stopped");
    },
  };
}
