import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { candidates, type NewCandidate, type Candidate } from "./schema.js";

export async function listCandidates(db: Db): Promise<Candidate[]> {
  return db.select().from(candidates).orderBy(desc(candidates.createdAt));
}

export async function listPending(db: Db): Promise<Candidate[]> {
  return db
    .select()
    .from(candidates)
    .where(eq(candidates.status, "pending"))
    .orderBy(candidates.createdAt);
}

export async function markSent(db: Db, id: string): Promise<void> {
  await db
    .update(candidates)
    .set({ status: "sent", sentAt: new Date(), lastDispatchError: null })
    .where(eq(candidates.id, id));
}

export async function markDispatchError(
  db: Db,
  id: string,
  error: string,
): Promise<void> {
  await db
    .update(candidates)
    .set({ lastDispatchError: error })
    .where(eq(candidates.id, id));
}

export async function saveEnrichmentByLinkedinUrl(
  db: Db,
  linkedinUrl: string,
  payload: unknown,
): Promise<boolean> {
  const rows = await db
    .update(candidates)
    .set({
      status: "enriched",
      enrichment: payload as Candidate["enrichment"],
      enrichedAt: new Date(),
    })
    .where(eq(candidates.linkedinUrl, linkedinUrl))
    .returning({ id: candidates.id });
  return rows.length > 0;
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
    if (row.isNew) inserted++;
    else updated++;
  }
  return { inserted, updated };
}
