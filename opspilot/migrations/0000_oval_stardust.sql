CREATE TABLE "op_ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor" varchar(120) NOT NULL,
	"action" varchar(80) NOT NULL,
	"subject" varchar(180) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"filename" varchar(180) NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(30) DEFAULT 'owner' NOT NULL,
	CONSTRAINT "op_member_workspace_user" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "op_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" varchar(180) NOT NULL,
	"message" text NOT NULL,
	"module" varchar(30) DEFAULT 'overview' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_payment_positive" CHECK ("op_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "op_rate_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"name" varchar(180) NOT NULL,
	"subtitle" varchar(250) DEFAULT '' NOT NULL,
	"status" varchar(40) DEFAULT 'Active' NOT NULL,
	"category" varchar(80) DEFAULT '' NOT NULL,
	"email" varchar(254) DEFAULT '' NOT NULL,
	"owner" varchar(120) DEFAULT '' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"due_date" varchar(10),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_record_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "op_positive_amount" CHECK ("op_records"."amount_cents" >= 0),
	CONSTRAINT "op_positive_stock" CHECK ("op_records"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "op_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "op_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "op_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "op_ai_usage" ADD CONSTRAINT "op_ai_usage_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_audit_events" ADD CONSTRAINT "op_audit_events_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_files" ADD CONSTRAINT "op_files_workspace_id_record_id_op_records_workspace_id_id_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."op_records"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_memberships" ADD CONSTRAINT "op_memberships_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_memberships" ADD CONSTRAINT "op_memberships_user_id_op_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."op_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_notifications" ADD CONSTRAINT "op_notifications_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_payments" ADD CONSTRAINT "op_payments_workspace_id_record_id_op_records_workspace_id_id_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."op_records"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_records" ADD CONSTRAINT "op_records_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_sessions" ADD CONSTRAINT "op_sessions_workspace_id_user_id_op_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."op_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_stock_movements" ADD CONSTRAINT "op_stock_movements_workspace_id_record_id_op_records_workspace_id_id_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."op_records"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "op_audit_workspace_date" ON "op_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "op_records_workspace_kind" ON "op_records" USING btree ("workspace_id","kind");