import Papa from "papaparse";
import { eq, sql } from "drizzle-orm";
import type { Context } from "../../trpc/context.js";
import * as repo from "./repo.js";
import * as jobsRepo from "./jobs-repo.js";
import { dispatchToClay } from "./clay.js";
import {
  candidates,
  enrichmentJobs,
  type NewCandidate,
} from "./schema.js";

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

export type EnrichResult = {
  dispatched: number;
  failed: { candidateId: string; reason: string }[];
};

/**
 * Phase A: keep slice-1's synchronous dispatch loop, but route state writes
 * through `enrichment_jobs`. The async worker lands in Phase B.
 *
 * Pulls every `queued` job, joins to the candidate, POSTs to Clay one at a
 * time with the 300ms gap. On 2xx → mark the job `dispatched`. On any
 * error → revert the job to `queued` with the error stamped on it (so it
 * shows up in the UI; no retry math yet).
 */
export async function enrichAll(ctx: Context): Promise<EnrichResult> {
  const queued = await ctx.db
    .select({
      jobId: enrichmentJobs.id,
      candidateId: candidates.id,
      fullName: candidates.fullName,
      linkedinUrl: candidates.linkedinUrl,
      email: candidates.email,
    })
    .from(enrichmentJobs)
    .innerJoin(candidates, eq(candidates.id, enrichmentJobs.candidateId))
    .where(eq(enrichmentJobs.status, "queued"))
    .orderBy(enrichmentJobs.createdAt);

  const failed: EnrichResult["failed"] = [];
  let dispatched = 0;

  console.log(`[enrich] dispatching ${queued.length} candidate(s) to Clay`);
  for (const c of queued) {
    console.log(
      `[enrich] → sending candidate=${c.candidateId} name="${c.fullName}" url=${c.linkedinUrl}`,
    );
    try {
      await dispatchToClay({
        candidate_id: c.candidateId,
        full_name: c.fullName,
        linkedin_url: c.linkedinUrl,
        email: c.email,
      });
      // Mark job as dispatched. Bump attempt_count + stamps to match what
      // the worker's atomic claim will do in Phase B.
      await ctx.db
        .update(enrichmentJobs)
        .set({
          status: "dispatched",
          dispatchedAt: new Date(),
          lastAttemptAt: new Date(),
          attemptCount: sql`${enrichmentJobs.attemptCount} + 1`,
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        .where(eq(enrichmentJobs.id, c.jobId));
      dispatched++;
      console.log(`[enrich] ✓ sent candidate=${c.candidateId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Keep the job queued for now; just stamp the error so it's visible.
      // Real retry/backoff math lands in Phase B's worker.
      await jobsRepo.revertToQueued(ctx.db, c.jobId, {
        code: "dispatch_error",
        message: reason,
        delaySeconds: 0,
      });
      failed.push({ candidateId: c.candidateId, reason });
      console.error(
        `[enrich] ✗ failed candidate=${c.candidateId} reason=${reason}`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(
    `[enrich] done — dispatched=${dispatched} failed=${failed.length}`,
  );
  return { dispatched, failed };
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
    return true;
  });
}
