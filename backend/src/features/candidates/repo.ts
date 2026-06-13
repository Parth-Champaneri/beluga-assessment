import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import {
  candidates,
  enrichmentJobs,
  profileJobs,
  type NewCandidate,
  type Candidate,
  type EnrichmentJobStatus,
  type ProfileJobStatus,
} from "./schema.js";
import * as jobsRepo from "./jobs-repo.js";

export type CandidateListRow = Omit<
  Candidate,
  "profileEmbedding" | "profileExtractionMeta"
> & {
  status: EnrichmentJobStatus | null;
  attemptCount: number | null;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  profileStatus: ProfileJobStatus | null;
  profileLastErrorCode: string | null;
  profileLastErrorMessage: string | null;
};

export async function listCandidates(db: Db): Promise<CandidateListRow[]> {
  const rows = await db
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      linkedinUrl: candidates.linkedinUrl,
      email: candidates.email,
      enrichment: candidates.enrichment,
      profile: candidates.profile,
      createdAt: candidates.createdAt,
      status: enrichmentJobs.status,
      attemptCount: enrichmentJobs.attemptCount,
      nextAttemptAt: enrichmentJobs.nextAttemptAt,
      lastAttemptAt: enrichmentJobs.lastAttemptAt,
      dispatchedAt: enrichmentJobs.dispatchedAt,
      completedAt: enrichmentJobs.completedAt,
      lastErrorCode: enrichmentJobs.lastErrorCode,
      lastErrorMessage: enrichmentJobs.lastErrorMessage,
      profileStatus: profileJobs.status,
      profileLastErrorCode: profileJobs.lastErrorCode,
      profileLastErrorMessage: profileJobs.lastErrorMessage,
    })
    .from(candidates)
    .leftJoin(enrichmentJobs, eq(enrichmentJobs.candidateId, candidates.id))
    .leftJoin(profileJobs, eq(profileJobs.candidateId, candidates.id))
    .orderBy(desc(candidates.createdAt));
  return rows;
}

export async function saveEnrichmentByLinkedinUrl(
  db: Db,
  linkedinUrl: string,
  payload: unknown,
): Promise<string | null> {
  const rows = await db
    .update(candidates)
    .set({
      enrichment: payload as Candidate["enrichment"],
    })
    .where(eq(candidates.linkedinUrl, linkedinUrl))
    .returning({ id: candidates.id });
  return rows[0]?.id ?? null;
}

export type UpsertResult = { inserted: number; updated: number };

export async function upsertCandidates(
  db: Db,
  rows: NewCandidate[],
): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const result = await db
    .insert(candidates)
    .values(rows)
    .onConflictDoUpdate({
      target: candidates.linkedinUrl,
      set: {
        fullName: sql`excluded.full_name`,
        email: sql`excluded.email`,
      },
    })
    .returning({
      id: candidates.id,
      isNew: sql<boolean>`xmax = 0`,
    });

  let inserted = 0;
  let updated = 0;
  for (const row of result) {
    if (row.isNew) {
      inserted++;
      // Newly inserted candidates need a fresh queued job.
      await jobsRepo.ensureJobForCandidate(db, row.id);
    } else {
      updated++;
      // Existing candidates keep their job as-is (idempotent re-upload).
    }
  }
  return { inserted, updated };
}
