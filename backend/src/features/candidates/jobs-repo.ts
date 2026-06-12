import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { enrichmentJobs, type EnrichmentJob } from "./schema.js";

/**
 * Insert a fresh `queued` job row for a candidate if one doesn't already
 * exist. Idempotent under the UNIQUE(candidate_id) constraint.
 */
export async function ensureJobForCandidate(
  db: Db,
  candidateId: string,
): Promise<void> {
  await db
    .insert(enrichmentJobs)
    .values({ candidateId })
    .onConflictDoNothing({ target: enrichmentJobs.candidateId });
}

export async function getJob(
  db: Db,
  candidateId: string,
): Promise<EnrichmentJob | null> {
  const rows = await db
    .select()
    .from(enrichmentJobs)
    .where(eq(enrichmentJobs.candidateId, candidateId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically claim ONE due job and flip it to `dispatched`. Returns the
 * claimed row (with updated fields) or null if nothing is due.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so concurrent ticks/workers can never pick
 * the same row.
 */
/**
 * Atomically claim up to `limit` due jobs and flip them to `dispatched`.
 * Returns the claimed rows (with updated fields) — empty array if nothing
 * is due. The dispatcher fans these out in parallel via Promise.allSettled.
 *
 * `FOR UPDATE SKIP LOCKED` makes concurrent ticks/workers safe.
 */
export async function claimDueBatch(
  db: Db,
  limit: number,
): Promise<EnrichmentJob[]> {
  // Raw SQL returns snake_case keys; alias them so the shape matches the
  // drizzle-inferred EnrichmentJob (camelCase). Without this, callers see
  // `claimed.candidateId === undefined` etc.
  const result = await db.execute<EnrichmentJob>(sql`
    UPDATE enrichment_jobs
       SET status          = 'dispatched',
           attempt_count   = attempt_count + 1,
           last_attempt_at = now(),
           dispatched_at   = now()
     WHERE id IN (
       SELECT id FROM enrichment_jobs
        WHERE status = 'queued'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id,
               candidate_id        AS "candidateId",
               status,
               attempt_count       AS "attemptCount",
               next_attempt_at     AS "nextAttemptAt",
               last_attempt_at     AS "lastAttemptAt",
               dispatched_at       AS "dispatchedAt",
               completed_at        AS "completedAt",
               last_error_code     AS "lastErrorCode",
               last_error_message  AS "lastErrorMessage",
               created_at          AS "createdAt";
  `);
  return result.rows as EnrichmentJob[];
}

/**
 * Send a row back to `queued` after a transient failure. Sets the next
 * attempt time, the error code, and a free-form message.
 */
export async function revertToQueued(
  db: Db,
  jobId: string,
  opts: { code: string; message: string; delaySeconds: number },
): Promise<void> {
  // `(numeric || text)::interval` errors in recent PG ("operator does not
  // exist: numeric || unknown"). Multiply a literal interval instead — works
  // for fractional seconds too.
  await db.execute(sql`
    UPDATE enrichment_jobs
       SET status             = 'queued',
           next_attempt_at    = now() + (${opts.delaySeconds} * interval '1 second'),
           last_error_code    = ${opts.code},
           last_error_message = ${opts.message}
     WHERE id = ${jobId};
  `);
}

export async function markFailed(
  db: Db,
  jobId: string,
  opts: { code: string; message: string },
): Promise<void> {
  await db
    .update(enrichmentJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      lastErrorCode: opts.code,
      lastErrorMessage: opts.message,
    })
    .where(eq(enrichmentJobs.id, jobId));
}

export async function markDone(db: Db, jobId: string): Promise<void> {
  await db
    .update(enrichmentJobs)
    .set({
      status: "done",
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    .where(eq(enrichmentJobs.id, jobId));
}

/**
 * Reset a `failed` job so the dispatcher will try it again from scratch.
 */
export async function resetFailedToQueued(db: Db): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE enrichment_jobs
       SET status             = 'queued',
           attempt_count      = 0,
           next_attempt_at    = now(),
           last_error_code    = NULL,
           last_error_message = NULL,
           completed_at       = NULL
     WHERE status = 'failed'
     RETURNING id;
  `);
  return result.rows.length;
}

/**
 * Bump all `queued` rows' `next_attempt_at` to now, so the dispatcher
 * picks them up on its next tick. Used by the "Enrich pending" button in
 * Phase B; safe to call now.
 */
export async function nudgeAllQueued(db: Db): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE enrichment_jobs
       SET next_attempt_at = now()
     WHERE status = 'queued'
     RETURNING id;
  `);
  return result.rows.length;
}

export async function pendingCount(db: Db): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
      FROM enrichment_jobs
     WHERE status = 'queued';
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export async function failedCount(db: Db): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
      FROM enrichment_jobs
     WHERE status = 'failed';
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Sweeper SQL: finds `dispatched` rows whose callback never arrived within
 * `callbackTimeoutSeconds`. Re-queues those with retry budget left,
 * marks the rest `failed`. One atomic UPDATE.
 *
 * Returns the number of rows touched.
 */
export async function sweepStuckDispatched(
  db: Db,
  opts: { maxAttempts: number; callbackTimeoutSeconds: number },
): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE enrichment_jobs
       SET status             = CASE WHEN attempt_count < ${opts.maxAttempts}
                                     THEN 'queued' ELSE 'failed' END,
           next_attempt_at    = CASE WHEN attempt_count < ${opts.maxAttempts}
                                     THEN now() + interval '30 seconds'
                                     ELSE next_attempt_at END,
           completed_at       = CASE WHEN attempt_count < ${opts.maxAttempts}
                                     THEN NULL ELSE now() END,
           last_error_code    = 'callback_timeout',
           last_error_message = 'Clay did not call back within '
                              || ${opts.callbackTimeoutSeconds} || 's'
     WHERE status = 'dispatched'
       AND dispatched_at < now() - (${opts.callbackTimeoutSeconds} * interval '1 second')
     RETURNING id;
  `);
  return result.rows.length;
}
