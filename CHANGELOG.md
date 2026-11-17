# Changelog

## 0.1.0 — OpsPilot foundation

### Added
- New branded responsive workspace and product/authentication pages.
- PostgreSQL/Drizzle tenant schema and generated migration.
- Registration, login/logout, membership-derived sessions, role policies, validation, audit events, and rate limits.
- Connected dashboard, CRM pipeline, invoices/payments, expenses, employee/vendor directories, projects/tasks, products/stock, documents, global search, and notifications.
- Local business insights and optional structured-intent provider integration.
- Reviewed draft-to-active notification workflows with execution history.
- Unit, database/API, fresh-migration, and browser regression suites.
- Environment/deployment/backup scaffolding and explicit security/unfinished-feature documentation.

### Corrected during review
- Public user response projection.
- Revenue attribution to payment dates.
- Cross-workspace invoice customer selection.
- Duplicate/retried/concurrent payment handling.
- Financial history overwrite restrictions.
- Document content validation and safe CSV export.
- Permission-aware dashboard visibility.
- Decorative accessible labels and local variable-font loading.

### Release limitations
This is not the complete requested ERP/HRMS/procurement/automation/billing roadmap. See `opspilot/docs/UNFINISHED.md` before evaluating production use.
