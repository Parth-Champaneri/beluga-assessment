import { desc } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { example, type NewExample } from "./schema.js";

export async function listExamples(db: Db) {
  return db.select().from(example).orderBy(desc(example.createdAt)).limit(50);
}

export async function createExample(db: Db, values: NewExample) {
  const [row] = await db.insert(example).values(values).returning();
  return row;
}
