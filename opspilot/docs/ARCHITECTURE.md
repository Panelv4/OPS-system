# Architecture

## Runtime

One Next.js App Router application serves the React UI and server-side route handlers. PostgreSQL is accessed through Drizzle. Browser requests never choose a tenant: a random opaque session cookie resolves to a hashed session row, workspace membership, role, and workspace.

The new implementation lives in `src/opspilot`; the App Router and database entry points connect it to the provisioned host. There is no dependency on a Panelv4 repository.

## Data model

Twelve tables: workspaces, users, memberships, sessions, records, payments, stock movements, audit events, notifications, files, rate limits, and AI usage.

Business records use an indexed `(workspace_id, kind)` model with validated module-specific states and structured details. This supports the delivered foundational screens; it is not a fully normalized statutory accounting, payroll, or procurement schema. Future mature modules should receive dedicated domain tables and migration-backed foreign keys.

Every business-owned table is tenant scoped. User identities and rate-limit buckets are intentionally global. Memberships determine tenant access. Sessions have a composite membership foreign key. Payments, stock movements, and files use composite `(workspace_id, record_id)` foreign keys to prevent cross-tenant associations at the database layer. `workspace_id` is never accepted in record mutation input.

PostgreSQL row-level security policies are not enabled. Application scoping plus composite relational constraints are tested; a restricted database role and audited RLS policies remain a production hardening layer.

## Money and stock

Amounts are integer USD cents. Input permits at most two decimal places. Invoice tax uses integer basis points with deterministic nearest-cent rounding. Discounts cannot exceed the subtotal. An invoice customer must exist in the same workspace.

Payments and stock adjustments lock the target record in a database transaction. Payments cannot be zero, negative, or exceed the outstanding balance. A client UUID identifies a payment request, making retries on an invoice idempotent. The primary key prevents duplicate inserts. Reusing a reference with different details is rejected. Stock cannot go negative and every adjustment has a reason and movement row.

Expenses and financial amounts cannot be overwritten through the update API. Payment and stock history are append-only through normal application operations. Administrative database access is outside this guarantee; no tamper-proof audit certification is claimed.

Revenue is based on the payment timestamp, expenses on their recorded timestamp, and outstanding balances on all invoices. Net profit is an operational cash-oriented difference, not a complete accrual-basis profit-and-loss report. No currency conversion or jurisdictional tax/payroll engine is present.

## Authorization

Seven role policies are defined in `src/opspilot/lib/domain.ts`: owner, administrator, manager, HR manager, accountant, salesperson, employee. Retrieval, mutation, document downloads, and AI queries apply the policies on the server. Workspace configuration is restricted to owner/administrator. Policies are code-configured, not editable through a permission-management UI.

## Assistant

The optional provider classifies a question into a strict intent enum. Provider output cannot directly change data, supply financial amounts, or issue SQL. Permission checks follow classification. Authorized workspace records are queried with deterministic application functions, then converted to an answer. Local keyword classification works without a provider. Workflow suggestions remain drafts requiring user review and activation.

## Workflows

Supported triggers: lead created, invoice created, task created, and product at/below reorder point. Supported action: create an in-app notification. Notification, execution count, and audit event are committed in the same transaction as the business event. A failed transaction does not leave a partial success. There is no background scheduler, durable retry queue, delay engine, email action, or multi-step visual editor yet.

## Files

PDF, PNG, JPEG, and UTF-8 text are accepted up to 5 MB after signature checks. Base64 file bytes are stored in PostgreSQL for this small-workspace foundation. Downloads require role and tenant authorization, use attachment disposition, and disable MIME sniffing. This is not an antivirus service or scalable S3 storage implementation.

## Frontend

A persistent sidebar and hash-based module routing keep the workspace cohesive. Server responses drive charts and metrics. Mutations refresh the workspace snapshot; there is no optimistic financial update. Modal focus management, keyboard search, responsive navigation, reduced-motion support, and persisted light/dark preferences are included.
