ALTER TABLE "candidates" ADD COLUMN "profile_extraction_meta" jsonb;--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "profile_embedding_input";