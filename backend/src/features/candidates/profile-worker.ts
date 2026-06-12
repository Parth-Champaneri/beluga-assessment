import type { Db } from "../../db/index.js";
import { env } from "../../lib/env.js";
import * as jobsRepo from "./profile-jobs-repo.js";
import { candidates, type ProfileJob } from "./schema.js";
import { eq } from "drizzle-orm";
import { extractProfile, embedProfile, type OpenAiErrorCode } from "./openai.js";
import { buildEmbeddingInput } from "./profile-builder.js";

/**
 * Module-scoped 429 gate. Separate from the Clay gate — different upstream.
 * Epoch-ms timestamp; while now() < this value the dispatcher sits out ticks.
 */
let rateLimitGateUntil = 0;

function backoff(attempt: number): number {
  const schedule = [5, 30, 120, 600, 3600];
  const base = schedule[Math.min(attempt - 1, schedule.length - 1)];
  return base * (0.8 + Math.random() * 0.4);
}

/**
 * Codes that are permanent and shouldn't trigger a retry. Everything else
 * is treated as transient (backoff + re-queue) up to PROFILE_MAX_ATTEMPTS.
 */
function isPermanent(code: OpenAiErrorCode | "no_enrichment"): boolean {
  return (
    code === "openai_4xx" ||
    code === "config" ||
    code === "validation_failed" ||
    code === "no_enrichment"
  );
}

export async function dispatcherPass(db: Db): Promise<void> {
  if (Date.now() < rateLimitGateUntil) return;

  const claimed = await jobsRepo.claimDueBatch(
    db,
    env.PROFILE_WORKER_CONCURRENCY,
  );
  if (claimed.length === 0) return;

  console.log(`[profile-worker] claimed ${claimed.length} job(s)`);

  await Promise.allSettled(claimed.map((job) => processOne(db, job)));
}

async function processOne(db: Db, claimed: ProfileJob): Promise<void> {
  const rows = await db
    .select({
      id: candidates.id,
      enrichment: candidates.enrichment,
    })
    .from(candidates)
    .where(eq(candidates.id, claimed.candidateId))
    .limit(1);
  const candidate = rows[0];

  if (!candidate) {
    await jobsRepo.markFailed(db, claimed.id, {
      code: "config",
      message: "candidate row missing",
    });
    return;
  }

  if (candidate.enrichment === null || candidate.enrichment === undefined) {
    await jobsRepo.markFailed(db, claimed.id, {
      code: "no_enrichment",
      message: "candidate.enrichment is null",
    });
    return;
  }

  const extracted = await extractProfile(candidate.enrichment);
  if (!extracted.ok) {
    await handleFailure(db, claimed, extracted.code, extracted.message, extracted.retryAfterSeconds);
    return;
  }

  const embeddingInput = buildEmbeddingInput(
    extracted.value.profile,
    candidate.enrichment,
  );

  const embedded = await embedProfile(embeddingInput);
  if (!embedded.ok) {
    await handleFailure(db, claimed, embedded.code, embedded.message, embedded.retryAfterSeconds);
    return;
  }

  await jobsRepo.markDoneWithProfile(db, claimed.id, candidate.id, {
    profile: extracted.value.profile,
    embedding: embedded.value,
    embeddingInput,
  });
  console.log(
    `[profile-worker] ✓ candidate=${candidate.id} archetype=${extracted.value.profile.archetype} seniority=${extracted.value.profile.seniority_band}`,
  );
}

async function handleFailure(
  db: Db,
  claimed: ProfileJob,
  code: OpenAiErrorCode | "no_enrichment",
  message: string,
  retryAfterSeconds?: number,
): Promise<void> {
  if (isPermanent(code)) {
    await jobsRepo.markFailed(db, claimed.id, { code, message });
    console.error(
      `[profile-worker] ✗ permanent candidate=${claimed.candidateId} code=${code}`,
    );
    return;
  }

  if (claimed.attemptCount >= env.PROFILE_MAX_ATTEMPTS) {
    await jobsRepo.markFailed(db, claimed.id, { code, message });
    console.error(
      `[profile-worker] ✗ exhausted candidate=${claimed.candidateId} code=${code} attempts=${claimed.attemptCount}`,
    );
    return;
  }

  if (code === "openai_429") {
    const retryAfter = retryAfterSeconds ?? 30;
    rateLimitGateUntil = Date.now() + retryAfter * 1000;
    const delaySeconds = Math.max(retryAfter, backoff(claimed.attemptCount));
    await jobsRepo.revertToQueued(db, claimed.id, {
      code,
      message,
      delaySeconds,
    });
    console.warn(
      `[profile-worker] ⏸ 429 candidate=${claimed.candidateId} gate=${retryAfter}s`,
    );
    return;
  }

  const delaySeconds = backoff(claimed.attemptCount);
  await jobsRepo.revertToQueued(db, claimed.id, {
    code,
    message,
    delaySeconds,
  });
  console.warn(
    `[profile-worker] ↻ retry candidate=${claimed.candidateId} code=${code} attempt=${claimed.attemptCount} delay=${delaySeconds.toFixed(1)}s`,
  );
}

export function startProfileWorker({ db }: { db: Db }): {
  stop: () => Promise<void>;
} {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopping) return;
    try {
      await dispatcherPass(db);
    } catch (err) {
      console.error("[profile-worker] tick error", err);
    } finally {
      if (!stopping) {
        timer = setTimeout(() => {
          inflight = tick();
        }, env.PROFILE_WORKER_INTERVAL_MS);
      }
    }
  }

  timer = setTimeout(() => {
    inflight = tick();
  }, 0);

  console.log(
    `[profile-worker] started — interval=${env.PROFILE_WORKER_INTERVAL_MS}ms concurrency=${env.PROFILE_WORKER_CONCURRENCY} maxAttempts=${env.PROFILE_MAX_ATTEMPTS}`,
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
      console.log("[profile-worker] stopped");
    },
  };
}
