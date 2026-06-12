CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "profile_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_jobs_candidate_id_unique" UNIQUE("candidate_id")
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "profile_embedding" vector(3072);--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "profile_embedding_input" text;--> statement-breakpoint
ALTER TABLE "profile_jobs" ADD CONSTRAINT "profile_jobs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_jobs_status_next_attempt_at_idx" ON "profile_jobs" USING btree ("status","next_attempt_at");