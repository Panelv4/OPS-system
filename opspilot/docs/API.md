# API reference — foundation release

All responses are JSON except document downloads. Mutations require a matching Origin header and JSON Content-Type (multipart for uploads). Authenticated endpoints use the `opspilot_session` HTTP-only cookie. Tenant identifiers in record request bodies are rejected.

Errors return `{ error: string }` with 400 for invalid input, 401 for unauthenticated access, 403 for authorization/origin failures, 404 for missing or other-tenant records, 409 for conflicting payment references, 413 for oversized requests, 415 for unsupported request format, and 429 for rate limiting.

## Session endpoints

- `POST /api/session/register`: email, password (10–128 chars), name, workspace. Creates a new empty workspace and owner session.
- `POST /api/session/login`: email, password. Returns an authenticated session cookie.
- `POST /api/session/logout`: empty JSON object. Revokes the current session.
- `POST /api/session/demo`: empty JSON object. Returns the current authenticated workspace, or creates a private persisted demo workspace if no session exists.

## Workspace

- `GET /api/workspace`: public user fields, workspace settings, permitted records, authorized recent activity, notifications, and module permissions. Private/no-store response.
- `PATCH /api/workspace`: optional name and/or widgets array. Owner/administrator only. Supported widgets: insights, metrics, charts, quickActions, tasks, activity.
- `GET /api/health`: database health, `{ ok: true }` on success.

## Business records

- `POST /api/records`: kind, name, optional subtitle, status, category, email, owner, amount (decimal string), quantity (integer), dueDate (ISO date or null), and validated details.
- Kinds: customers, leads, invoices, expenses, employees, projects, tasks, products, vendors, workflows. Documents use the upload endpoint.
- Details may include notes, priority, reorderPoint, trigger, action, invoice lines, taxBps, discountCents, description.
- Invoice lines: description, quantity, unitCents. Server recomputes totals. The invoice subtitle must identify an existing same-workspace customer.
- New workflows are always drafts. The only action is notification; trigger must be lead.created, invoice.created, stock.low, or task.created.
- `GET /api/records/:id`: authorized record with payment/stock/activity history.
- `PATCH /api/records/:id`: one of the following explicit actions:
  - Status: action=status, status=valid module status. Cannot rewrite financial/document statuses.
  - Payment: action=payment, amount=positive decimal string, requestId=client-generated UUID. Reuse the same UUID when retrying the same payment. Different payment details cannot reuse a reference.
  - Stock: action=stock, delta=nonzero signed integer, reason=3–500 chars. Negative resulting stock is rejected.

A status update activating a workflow is an explicit activation request. The interface also requires the human review checkbox before sending it. There is no general-purpose delete or historical financial overwrite endpoint.

## Documents

- `POST /api/documents`: multipart `file` and optional `category`. PDF, PNG, JPEG, UTF-8 TXT; maximum 5 MB. File signatures must match the filename type.
- `GET /api/documents/:recordId`: authorized attachment download. MIME sniffing and shared caching are disabled.

## Notifications

- `PATCH /api/notifications`: id=UUID to mark one read, or all=true to mark the workspace notifications read. Notifications are workspace scoped, not individualized delivery receipts.

## Intelligence

- `POST /api/intelligence`: question (2–1,000 chars).
- Returns answer, provider label, generatedAt, and optional workflow draft.
- Supported topics: overview, this-month revenue/profit, overdue invoices, largest expenses, low stock, lead follow-ups, active/delayed projects/tasks, notification workflow drafts.
- Queries are permission checked. Unsupported unrestricted natural-language database querying is not implemented.
- No writes or emails are executed by this endpoint. Optional LLM calls require explicit server configuration.

## Limits and contracts

The workspace endpoint currently returns a bounded activity/notification history but an unpaginated set of business records. This is suitable for the foundation's small-workspace scope, not large enterprise datasets. Dates are stored as timestamps or ISO dates; amounts are USD cents in responses and decimal strings in creation/payment requests. API versioning, pagination, OpenAPI generation, webhooks, and public integration tokens remain roadmap work.
