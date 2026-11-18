CREATE TABLE "op_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "op_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(60) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"dedupe_key" varchar(160),
	"workspace_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(80),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "op_job_runs" ADD CONSTRAINT "op_job_runs_job_id_op_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."op_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_jobs" ADD CONSTRAINT "op_jobs_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "op_job_runs_job" ON "op_job_runs" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE INDEX "op_jobs_status_run_at" ON "op_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "op_jobs_kind_created" ON "op_jobs" USING btree ("kind","created_at");