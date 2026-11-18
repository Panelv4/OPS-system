CREATE TABLE "op_email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"recipient" varchar(254) NOT NULL,
	"template" varchar(40) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"status" varchar(20) NOT NULL,
	"provider_id" varchar(120),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"email" varchar(254) NOT NULL,
	"user_id" uuid,
	"workspace_id" uuid,
	"role" varchar(30),
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_email_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "op_users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "op_email_log" ADD CONSTRAINT "op_email_log_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_email_tokens" ADD CONSTRAINT "op_email_tokens_user_id_op_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."op_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_email_tokens" ADD CONSTRAINT "op_email_tokens_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "op_email_log_recipient" ON "op_email_log" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "op_email_tokens_email_purpose" ON "op_email_tokens" USING btree ("email","purpose");--> statement-breakpoint
CREATE INDEX "op_email_tokens_expires" ON "op_email_tokens" USING btree ("expires_at");