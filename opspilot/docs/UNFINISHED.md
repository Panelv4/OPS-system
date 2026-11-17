# Unfinished features and release boundaries

This is an implemented and tested foundation, **not completion of all eleven requested roadmap phases**. The following features are intentionally not represented by fake integrations or inert controls.

## Identity and tenancy

- Email verification, password reset delivery, invitation acceptance, MFA, editable permission policies, member-management UI, multiple-workspace membership switching, account deletion/export, and fine-grained ownership rules.
- Role and tenant foundations exist; production lifecycle and governance do not.

## CRM and sales

- Rich customer addresses/phone/tags, full customer editing, linked purchase/communication timelines, actual follow-up emails, quotations, sales orders, credit notes/refunds, payment gateway charging, automated invoice reminders, and server-generated PDF files.
- Browser print/Save PDF works. It is not a server-side PDF service.
- Invoice customers are workspace-validated by name, not a fully normalized relational CRM ledger. Dedicated invoice/customer foreign-key models are a follow-up before mutable customer identifiers are introduced.

## Finance

- Double-entry ledger, accrual accounting, reconciliation, formal cash-flow/P&L statements, fiscal periods, expense corrections/reversals, payables/vendor payments, bank feeds, receipt extraction, and jurisdiction-specific tax rules.
- Current revenue and net figures are operational recorded-cash summaries in USD, not statutory accounts.

## HRMS

- Employee salary structures, confidential document ACLs, attendance/check-in/out, leave requests/approvals/balances, payroll, payslips, benefits, jurisdiction-aware deductions, and HR compliance.
- The employee directory and department/status records work; no payroll module is claimed.

## Inventory and procurement

- Purchase costs/valuation methods, purchase orders and approvals, goods receipt linking, vendor invoices, stock transfers/returns, warehouse/location tracking, and reorder purchasing.
- Product records, stock movements, low-stock flags, and vendor profiles are functional foundations.

## Projects and collaboration

- Calendar view, comments/attachments linked to tasks, granular project membership, time tracking, and real-time collaboration.
- List, project cards, draggable task/lead boards, assignments, due dates, and statuses work.

## Documents and notifications

- S3-compatible storage, versions, inline previews, expiration reminders, per-document ACLs, virus scanning, OCR/extraction, email notifications, and per-user delivery/preferences.
- Small private database-backed uploads/downloads and workspace in-app notifications are implemented.

## Intelligence and automation

- Broad unrestricted NL-to-SQL, long-lived chat history, anomaly detection, report generation/export, receipt extraction, adaptive recommendations, multi-step visual workflow editor, conditions, delays, scheduling, durable retries, failed-run dashboards, email actions, and external integrations.
- The optional provider adapter is untested with live credentials; local authorized factual queries and draft notification workflows were exercised.
- Current workflows are transactional event notifications, not a distributed background-job engine.

## Commercial operations and hardening

- Billing checkout, subscriptions, entitlements, metered plans, taxes on subscriptions, support operations, Redis/Celery workers, production object storage, observability, quotas, retention jobs, scaling/pagination, full accessibility certification, load/penetration testing, managed backup/restore, and commercial compliance.
- Pricing is a clearly labeled proposal; no subscription or payment is created.
- Docker/CI definitions are supplied but not validated by actually running Docker or hosted CI.
- Tooling dependency moderate advisories remain; see SECURITY.md.

## Next recommended release

1. Harden public identity lifecycle, trusted ingress, quotas/retention, and least-privilege/RLS isolation.
2. Normalize invoicing/finance relations and introduce corrections with audited reversal entries.
3. Add membership/invitations and document confidentiality before real HR data.
4. Implement purchasing/receiving and inventory valuation as an integrated transaction flow.
5. Add durable job execution and observability before scheduled automation or email delivery.
6. Add billing only after these operational/security foundations are complete.
