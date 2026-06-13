import { desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Context } from "../../trpc/context.js";
import { jobDescriptions, type JobDescription } from "./schema.js";
import { extractJobProfile, embedText } from "./openai.js";
import { buildJobEmbeddingInput } from "./job-builder.js";

export type JobDescriptionListRow = Omit<
  JobDescription,
  "profileEmbedding" | "profileExtractionMeta"
>;

/**
 * Synchronous ingest: extract → embed → persist in one mutation. The user
 * is in the loop (pasting a JD and waiting), so no queue, no retry —
 * surface errors directly as TRPCErrors. Total roundtrip is ~3-8s.
 */
export async function ingestJobDescription(
  ctx: Context,
  input: { title?: string | null; descriptionText: string },
): Promise<JobDescriptionListRow> {
  const trimmedTitle = input.title?.trim() || null;

  const extracted = await extractJobProfile(input.descriptionText);
  if (!extracted.ok) {
    throw new TRPCError({
      code:
        extracted.code === "config"
          ? "PRECONDITION_FAILED"
          : extracted.code === "openai_429"
            ? "TOO_MANY_REQUESTS"
            : "INTERNAL_SERVER_ERROR",
      message: `extract failed: ${extracted.code} — ${extracted.message}`,
    });
  }

  const embeddingInput = buildJobEmbeddingInput(extracted.value.profile);
  const embedded = await embedText(embeddingInput, "job");
  if (!embedded.ok) {
    throw new TRPCError({
      code:
        embedded.code === "config"
          ? "PRECONDITION_FAILED"
          : embedded.code === "openai_429"
            ? "TOO_MANY_REQUESTS"
            : "INTERNAL_SERVER_ERROR",
      message: `embed failed: ${embedded.code} — ${embedded.message}`,
    });
  }

  // pgvector's `vector` type takes a `'[a,b,c,...]'::vector` literal, so
  // we emit the embedding as raw SQL like the candidate side does.
  const vectorLiteral = `[${embedded.value.join(",")}]`;
  const rows = await ctx.db.execute<{
    id: string;
    title: string | null;
    description_text: string;
    profile: unknown;
    created_at: string;
  }>(sql`
    INSERT INTO job_descriptions (
      title,
      description_text,
      profile,
      profile_extraction_meta,
      profile_embedding
    ) VALUES (
      ${trimmedTitle},
      ${input.descriptionText},
      ${JSON.stringify(extracted.value.profile)}::jsonb,
      ${JSON.stringify(extracted.value.extractionMeta)}::jsonb,
      ${vectorLiteral}::vector
    )
    RETURNING id, title, description_text, profile, created_at;
  `);

  const inserted = rows.rows[0];
  if (!inserted) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "insert returned no rows",
    });
  }

  console.log(
    `[jobs] ingested id=${inserted.id} title="${trimmedTitle ?? "(untitled)"}" role_title="${extracted.value.profile.role_title}"`,
  );

  return {
    id: inserted.id,
    title: inserted.title,
    descriptionText: inserted.description_text,
    profile: inserted.profile,
    createdAt: new Date(inserted.created_at),
  };
}

export async function list(ctx: Context): Promise<JobDescriptionListRow[]> {
  return ctx.db
    .select({
      id: jobDescriptions.id,
      title: jobDescriptions.title,
      descriptionText: jobDescriptions.descriptionText,
      profile: jobDescriptions.profile,
      createdAt: jobDescriptions.createdAt,
    })
    .from(jobDescriptions)
    .orderBy(desc(jobDescriptions.createdAt));
}

export async function get(
  ctx: Context,
  input: { id: string },
): Promise<JobDescriptionListRow | null> {
  const rows = await ctx.db
    .select({
      id: jobDescriptions.id,
      title: jobDescriptions.title,
      descriptionText: jobDescriptions.descriptionText,
      profile: jobDescriptions.profile,
      createdAt: jobDescriptions.createdAt,
    })
    .from(jobDescriptions)
    .where(eq(jobDescriptions.id, input.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function remove(
  ctx: Context,
  input: { id: string },
): Promise<{ deleted: boolean }> {
  const result = await ctx.db
    .delete(jobDescriptions)
    .where(eq(jobDescriptions.id, input.id))
    .returning({ id: jobDescriptions.id });
  return { deleted: result.length > 0 };
}

export type CandidateMatch = {
  id: string;
  fullName: string;
  linkedinUrl: string;
  email: string | null;
  profile: unknown;
  profileStatus: string | null;
  similarity: number;
};

/**
 * Rank candidates against a JD by cosine similarity. Uses pgvector's
 * `<=>` (cosine distance) — for the OpenAI embeddings (already L2-
 * normalized) this gives `similarity = 1 - distance` in [-1, 1].
 *
 * Candidates without an embedding are skipped (no profile yet, or extract
 * failed). They show up zero — the UI surfaces this so the user knows.
 */
export async function findMatchesForJob(
  ctx: Context,
  input: { jobId: string; limit?: number },
): Promise<CandidateMatch[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  // Confirm the JD exists and has an embedding before running the
  // (otherwise empty) cosine sim — gives a useful error instead of a
  // silent empty list.
  const jdCheck = await ctx.db.execute<{ has_embedding: boolean }>(sql`
    SELECT (profile_embedding IS NOT NULL) AS has_embedding
      FROM job_descriptions
     WHERE id = ${input.jobId}
     LIMIT 1;
  `);
  if (jdCheck.rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "job description not found" });
  }
  if (!jdCheck.rows[0]?.has_embedding) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "job description has no embedding yet",
    });
  }

  const result = await ctx.db.execute<{
    id: string;
    full_name: string;
    linkedin_url: string;
    email: string | null;
    profile: unknown;
    profile_status: string | null;
    similarity: number | string;
  }>(sql`
    WITH jd AS (
      SELECT profile_embedding FROM job_descriptions WHERE id = ${input.jobId}
    )
    SELECT c.id,
           c.full_name,
           c.linkedin_url,
           c.email,
           c.profile,
           pj.status AS profile_status,
           1 - (c.profile_embedding <=> (SELECT profile_embedding FROM jd)) AS similarity
      FROM candidates c
      LEFT JOIN profile_jobs pj ON pj.candidate_id = c.id
     WHERE c.profile_embedding IS NOT NULL
     ORDER BY c.profile_embedding <=> (SELECT profile_embedding FROM jd) ASC
     LIMIT ${limit};
  `);

  return result.rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    linkedinUrl: r.linkedin_url,
    email: r.email,
    profile: r.profile,
    profileStatus: r.profile_status,
    similarity: Number(r.similarity),
  }));
}
