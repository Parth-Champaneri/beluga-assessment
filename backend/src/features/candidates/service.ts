import Papa from "papaparse";
import { eq } from "drizzle-orm";
import type { Context } from "../../trpc/context.js";
import * as repo from "./repo.js";
import * as jobsRepo from "./jobs-repo.js";
import * as profileJobsRepo from "./profile-jobs-repo.js";
import { candidates, type NewCandidate } from "./schema.js";

export type IngestRowError = { row: number; reason: string };
export type IngestResult = {
  inserted: number;
  updated: number;
  errors: IngestRowError[];
};

export function normalizeLinkedinUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.endsWith("linkedin.com")) return null;
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path.startsWith("/in/")) return null;
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

export async function ingestCsv(
  ctx: Context,
  input: { csvText: string },
): Promise<IngestResult> {
  const parsed = Papa.parse<Record<string, string>>(input.csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const errors: IngestRowError[] = [];
  const seenUrls = new Set<string>();
  const rows: NewCandidate[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 2; // header is row 1
    const fullName = (raw.full_name ?? raw.name ?? "").trim();
    const linkedinRaw = (raw.linkedin_url ?? raw.linkedin ?? "").trim();
    const email = (raw.email ?? "").trim() || null;

    if (!fullName) {
      errors.push({ row: rowNum, reason: "missing full_name" });
      return;
    }
    if (!linkedinRaw) {
      errors.push({ row: rowNum, reason: "missing linkedin_url" });
      return;
    }
    const linkedinUrl = normalizeLinkedinUrl(linkedinRaw);
    if (!linkedinUrl) {
      errors.push({ row: rowNum, reason: `invalid linkedin_url: ${linkedinRaw}` });
      return;
    }
    if (seenUrls.has(linkedinUrl)) {
      errors.push({ row: rowNum, reason: "duplicate linkedin_url in CSV" });
      return;
    }
    seenUrls.add(linkedinUrl);
    rows.push({ fullName, linkedinUrl, email });
  });

  const { inserted, updated } = await repo.upsertCandidates(ctx.db, rows);
  return { inserted, updated, errors };
}

export async function list(ctx: Context) {
  return repo.listCandidates(ctx.db);
}

/**
 * "Enrich pending" — mass-bump `next_attempt_at = now()` on every queued
 * job so the worker picks them up on its next tick. The worker, not this
 * call, does the actual dispatch.
 */
export async function nudgeQueued(
  ctx: Context,
): Promise<{ queued: number }> {
  const queued = await jobsRepo.nudgeAllQueued(ctx.db);
  console.log(`[nudge] queued ${queued} job(s) for immediate dispatch`);
  return { queued };
}

/**
 * "Retry failed" — reset all `failed` jobs back to `queued`, clearing
 * attempt count and error fields. Worker picks them up on the next tick.
 */
export async function retryFailed(
  ctx: Context,
): Promise<{ reset: number }> {
  const reset = await jobsRepo.resetFailedToQueued(ctx.db);
  console.log(`[retry] reset ${reset} failed job(s) to queued`);
  return { reset };
}

/**
 * Apply a Clay callback. Writes the enrichment payload to `candidates` AND
 * flips the matched job to `done` in a single transaction.
 *
 * - If no candidate matches the linkedin_url → returns false.
 * - If the matched job was already `failed` (we gave up but Clay arrived
 *   late) we still accept the callback and log a warning.
 * - Idempotent: re-delivery just overwrites the same fields.
 */
export async function applyCallback(
  ctx: Context,
  linkedinUrl: string,
  payload: unknown,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    // Type-assert: drizzle's transaction handle is structurally the same as
    // our Db type for our purposes (we only use select/update/execute).
    const txDb = tx as unknown as typeof ctx.db;

    const updated = await txDb
      .update(candidates)
      .set({ enrichment: payload as never })
      .where(eq(candidates.linkedinUrl, linkedinUrl))
      .returning({ id: candidates.id });

    const candidateId = updated[0]?.id;
    if (!candidateId) return false;

    const job = await jobsRepo.getJob(txDb, candidateId);
    if (job && job.status === "failed") {
      console.warn(
        `[clay-callback] ⚠ late callback for failed job candidate=${candidateId} — accepting and flipping to done`,
      );
    }
    if (job) {
      await jobsRepo.markDone(txDb, job.id);
    } else {
      // Belt-and-suspenders: shouldn't happen (upsert creates a job) but if
      // somehow missing, create one in `done` state so the row is consistent.
      console.warn(
        `[clay-callback] ⚠ no job row for candidate=${candidateId} — creating one in done state`,
      );
      await jobsRepo.ensureJobForCandidate(txDb, candidateId);
      const created = await jobsRepo.getJob(txDb, candidateId);
      if (created) await jobsRepo.markDone(txDb, created.id);
    }

    // Enqueue the follow-on profile extraction in the same tx. Idempotent
    // via UNIQUE(candidate_id); a re-delivered callback won't double-queue.
    await profileJobsRepo.ensureJobForCandidate(txDb, candidateId);

    return true;
  });
}
