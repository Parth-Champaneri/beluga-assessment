import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { profileJobs, type ProfileJob } from "./schema.js";

/**
 * Insert a fresh `queued` profile job row for a candidate if one doesn't
 * already exist. Idempotent under the UNIQUE(candidate_id) constraint.
 */
export async function ensureJobForCandidate(
  db: Db,
  candidateId: string,
): Promise<void> {
  await db
    .insert(profileJobs)
    .values({ candidateId })
    .onConflictDoNothing({ target: profileJobs.candidateId });
}

export async function getJob(
  db: Db,
  candidateId: string,
): Promise<ProfileJob | null> {
  const rows = await db
    .select()
    .from(profileJobs)
    .where(eq(profileJobs.candidateId, candidateId))
    .limit(1);
  return rows[0] ?? null;
}

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
): Promise<ProfileJob[]> {
  // Raw SQL returns snake_case keys; alias them so the shape matches the
  // drizzle-inferred ProfileJob (camelCase). Without this, callers see
  // `claimed.candidateId === undefined` etc.
  const result = await db.execute<ProfileJob>(sql`
    UPDATE profile_jobs
       SET status          = 'dispatched',
           attempt_count   = attempt_count + 1,
           last_attempt_at = now(),
           dispatched_at   = now()
     WHERE id IN (
       SELECT id FROM profile_jobs
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
  return result.rows as ProfileJob[];
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
    UPDATE profile_jobs
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
    .update(profileJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      lastErrorCode: opts.code,
      lastErrorMessage: opts.message,
    })
    .where(eq(profileJobs.id, jobId));
}

export async function markDone(db: Db, jobId: string): Promise<void> {
  await db
    .update(profileJobs)
    .set({
      status: "done",
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    .where(eq(profileJobs.id, jobId));
}

/**
 * Atomically write the candidate's profile + extraction meta + embedding,
 * then flip the job to `done`. Callers typically pass a tx handle as `db`
 * so both writes commit together.
 *
 * pgvector's `vector` type requires a `'[a,b,c,...]'::vector` literal, so
 * the embedding is emitted as raw SQL rather than a bound array param.
 */
export async function markDoneWithProfile(
  db: Db,
  jobId: string,
  candidateId: string,
  payload: {
    profile: unknown;
    extractionMeta: unknown;
    embedding: number[];
  },
): Promise<void> {
  const vectorLiteral = `[${payload.embedding.join(",")}]`;
  await db.execute(sql`
    UPDATE candidates
       SET profile                  = ${JSON.stringify(payload.profile)}::jsonb,
           profile_extraction_meta  = ${JSON.stringify(payload.extractionMeta)}::jsonb,
           profile_embedding        = ${vectorLiteral}::vector
     WHERE id = ${candidateId};
  `);
  await markDone(db, jobId);
}

/**
 * Reset a `failed` job so the dispatcher will try it again from scratch.
 */
export async function resetFailedToQueued(db: Db): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE profile_jobs
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
 * picks them up on its next tick.
 */
export async function nudgeAllQueued(db: Db): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE profile_jobs
       SET next_attempt_at = now()
     WHERE status = 'queued'
     RETURNING id;
  `);
  return result.rows.length;
}

export async function pendingCount(db: Db): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
      FROM profile_jobs
     WHERE status = 'queued';
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export async function failedCount(db: Db): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
      FROM profile_jobs
     WHERE status = 'failed';
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Boot-time catch-up: queue a profile job for every enriched candidate
 * that doesn't already have one. Idempotent — safe to call on every start.
 */
export async function backfillMissingProfileJobs(db: Db): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO profile_jobs (candidate_id)
    SELECT c.id
      FROM candidates c
      LEFT JOIN profile_jobs pj ON pj.candidate_id = c.id
     WHERE c.enrichment IS NOT NULL
       AND pj.id IS NULL
    ON CONFLICT (candidate_id) DO NOTHING
    RETURNING id;
  `);
  return result.rows.length;
}
