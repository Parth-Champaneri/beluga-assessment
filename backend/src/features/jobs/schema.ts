import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  vector,
} from "drizzle-orm/pg-core";

export const jobDescriptions = pgTable("job_descriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Optional user-supplied label so the list view is scannable. */
  title: text("title"),
  /** Raw JD pasted by the user — kept verbatim for re-extraction. */
  descriptionText: text("description_text").notNull(),
  /** LLM-extracted facets. Same shape concept as candidate.profile. */
  profile: jsonb("profile"),
  /** Audit metadata: model, prompt_version, tokens, timestamp. */
  profileExtractionMeta: jsonb("profile_extraction_meta"),
  /** Same vector space as candidates.profile_embedding — cosine sim works. */
  profileEmbedding: vector("profile_embedding", { dimensions: 3072 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type JobDescription = typeof jobDescriptions.$inferSelect;
export type NewJobDescription = typeof jobDescriptions.$inferInsert;
