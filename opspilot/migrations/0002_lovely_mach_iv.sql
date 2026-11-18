CREATE TABLE "op_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"type" varchar(80) NOT NULL,
	"workspace_id" uuid,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "op_billing_events_provider_event" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "op_subscriptions" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan" varchar(20) DEFAULT 'free' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"provider" varchar(20) DEFAULT 'manual' NOT NULL,
	"provider_customer_id" varchar(120),
	"provider_subscription_id" varchar(120),
	"seats" integer DEFAULT 2 NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "op_billing_events" ADD CONSTRAINT "op_billing_events_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_subscriptions" ADD CONSTRAINT "op_subscriptions_workspace_id_op_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."op_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "op_billing_events_workspace" ON "op_billing_events" USING btree ("workspace_id","received_at");