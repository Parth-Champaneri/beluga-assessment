CREATE TABLE "enrichment_jobs" (
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
	CONSTRAINT "enrichment_jobs_candidate_id_unique" UNIQUE("candidate_id")
);
--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_jobs_status_next_attempt_at_idx" ON "enrichment_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "last_dispatch_error";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "sent_at";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "enriched_at";