import { pgTable, uuid, varchar, text, timestamp, integer, boolean, jsonb, unique, index, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaces = pgTable("op_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const users = pgTable("op_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Set when the address is proven; drives reminder banners and invite gating. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const memberships = pgTable("op_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 30 }).notNull().default("owner"),
}, (t) => [unique("op_member_workspace_user").on(t.workspaceId, t.userId)]);
export const sessions = pgTable("op_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: uuid("user_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }).onDelete("cascade"), index("op_sessions_expires").on(t.expiresAt)]);

export const records = pgTable("op_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 24 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  subtitle: varchar("subtitle", { length: 250 }).notNull().default(""),
  status: varchar("status", { length: 40 }).notNull().default("Active"),
  category: varchar("category", { length: 80 }).notNull().default(""),
  email: varchar("email", { length: 254 }).notNull().default(""),
  owner: varchar("owner", { length: 120 }).notNull().default(""),
  amountCents: integer("amount_cents").notNull().default(0),
  quantity: integer("quantity").notNull().default(0),
  dueDate: varchar("due_date", { length: 10 }),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("op_record_workspace_id").on(t.workspaceId, t.id),
  index("op_records_workspace_kind").on(t.workspaceId, t.kind),
  check("op_positive_amount", sql`${t.amountCents} >= 0`),
  check("op_positive_stock", sql`${t.quantity} >= 0`),
]);
export const payments = pgTable("op_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  recordId: uuid("record_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.recordId], foreignColumns: [records.workspaceId, records.id] }).onDelete("restrict"), check("op_payment_positive", sql`${t.amountCents} > 0`)]);
export const stockMovements = pgTable("op_stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  recordId: uuid("record_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.recordId], foreignColumns: [records.workspaceId, records.id] }).onDelete("restrict")]);
export const auditEvents = pgTable("op_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actor: varchar("actor", { length: 120 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  subject: varchar("subject", { length: 180 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("op_audit_workspace_date").on(t.workspaceId, t.createdAt)]);
export const notifications = pgTable("op_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  module: varchar("module", { length: 30 }).notNull().default("overview"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const files = pgTable("op_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  recordId: uuid("record_id").notNull(),
  filename: varchar("filename", { length: 180 }).notNull(),
  contentType: varchar("content_type", { length: 80 }).notNull(),
  size: integer("size").notNull(),
  content: text("content").notNull(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.recordId], foreignColumns: [records.workspaceId, records.id] }).onDelete("cascade")]);
export const rateLimits = pgTable("op_rate_limits", {
  key: varchar("key", { length: 64 }).primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("op_rate_limits_expires").on(t.expiresAt)]);
export const aiUsage = pgTable("op_ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 40 }).notNull(),
  tokens: integer("tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Billing state. One subscription per workspace, created lazily on first read so
 * existing workspaces keep working (they resolve to the free plan).
 */
export const subscriptions = pgTable("op_subscriptions", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 20 }).notNull().default("free"),
  /** active | trialing | past_due | canceled | incomplete */
  status: varchar("status", { length: 20 }).notNull().default("active"),
  /** manual (self-hosted / no gateway) | test | stripe */
  provider: varchar("provider", { length: 20 }).notNull().default("manual"),
  providerCustomerId: varchar("provider_customer_id", { length: 120 }),
  providerSubscriptionId: varchar("provider_subscription_id", { length: 120 }),
  seats: integer("seats").notNull().default(2),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** Set when cancellation is requested; access continues until this instant. */
  cancelAt: timestamp("cancel_at", { withTimezone: true }),
  /** Access continues until here after a failed payment (failed-payment grace). */
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Append-only ledger of gateway events. `(provider, event_id)` is unique, which
 * is what makes webhook processing idempotent under at-least-once delivery.
 */
export const billingEvents = pgTable("op_billing_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 20 }).notNull(),
  eventId: varchar("event_id", { length: 200 }).notNull(),
  type: varchar("type", { length: 80 }).notNull(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  /** received | applied | ignored | failed */
  status: varchar("status", { length: 20 }).notNull().default("received"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [unique("op_billing_events_provider_event").on(t.provider, t.eventId), index("op_billing_events_workspace").on(t.workspaceId, t.receivedAt)]);

/**
 * Single-use, hashed action tokens for email verification, password recovery and
 * workspace invitations. Only the SHA-256 hash is stored, so a database leak does
 * not hand out working links.
 */
export const emailTokens = pgTable("op_email_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** verify | reset | invite */
  purpose: varchar("purpose", { length: 20 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 254 }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  /** Role to grant on invitation acceptance. */
  role: varchar("role", { length: 30 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("op_email_tokens_email_purpose").on(t.email, t.purpose),
  index("op_email_tokens_expires").on(t.expiresAt),
]);

/**
 * Delivery log for every outbound email. Kept in-app (not only in the provider)
 * so support can answer "did the reset email actually go out?".
 */
export const emailLog = pgTable("op_email_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  recipient: varchar("recipient", { length: 254 }).notNull(),
  template: varchar("template", { length: 40 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  /** sent | failed | suppressed */
  status: varchar("status", { length: 20 }).notNull(),
  providerId: varchar("provider_id", { length: 120 }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("op_email_log_recipient").on(t.recipient, t.createdAt)]);

/**
 * Durable job queue. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so several
 * tick callers (a cron, a lambda, a second app instance) never run the same job
 * twice, and a crashed worker's lease is reclaimed after the lease window.
 * Backed by Postgres on purpose: no Redis, no worker host, no extra bill.
 */
export const jobs = pgTable("op_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: varchar("kind", { length: 60 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  /** pending | running | done | failed | dead */
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(6),
  /** Idempotency key: prevents scheduling the same logical job twice. */
  dedupeKey: varchar("dedupe_key", { length: 160 }).unique(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: varchar("locked_by", { length: 80 }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("op_jobs_status_run_at").on(t.status, t.runAt),
  index("op_jobs_kind_created").on(t.kind, t.createdAt),
]);

/** One row per execution attempt, so run history survives retries and dead letters. */
export const jobRuns = pgTable("op_job_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  /** succeeded | failed | dead */
  status: varchar("status", { length: 20 }).notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("op_job_runs_job").on(t.jobId, t.startedAt)]);
