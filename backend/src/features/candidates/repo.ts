import { desc, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { candidates, type NewCandidate, type Candidate } from "./schema.js";

export async function listCandidates(db: Db): Promise<Candidate[]> {
  return db.select().from(candidates).orderBy(desc(candidates.createdAt));
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
