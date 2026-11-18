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
