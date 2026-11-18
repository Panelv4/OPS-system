# Subprocessors — draft, must match deployed reality

Updated 2026-11-18. A subprocessor is listed here only if a deployment *can* send customer
data to it. Self-hosted deployments that set none of these variables have no subprocessors
beyond the hosting provider they chose.

| Subprocessor | Purpose | Data exposed | Activated by | Region |
| --- | --- | --- | --- | --- |
| Application hosting provider (customer-chosen: e.g. Vercel, Fly.io, Hetzner, AWS) | runs the application | everything the application processes | always | depends on deployment |
| Managed PostgreSQL provider (customer-chosen: RDS, Neon, Supabase, self-hosted) | stores all application data | all customer data | always | depends on deployment |
| Resend | transactional email delivery | recipient address, message body (which contains a single-use link) | `MAIL_TRANSPORT=resend` + `RESEND_API_KEY` | US |
| Brevo | transactional email delivery | recipient address, message body | `MAIL_TRANSPORT=brevo` + `BREVO_API_KEY` | EU (France) |
| OpenAI (or an API-compatible provider) | AI analyst answers | the question text plus the workspace figures included in the prompt | `AI_ENABLED=true` + `OPENAI_API_KEY` | US |
| Object storage provider (S3-compatible) | document storage | uploaded documents | *not implemented yet* (T-301) | — |

Notes that matter for a real DPA:

- Email bodies contain verification, reset and invitation **links**, which are
  credentials until used. Treat the email provider as a processor of authentication data.
- AI prompts contain business figures. Customers must be able to turn the feature off;
  today that is `AI_ENABLED=false`, which disables it instance-wide, not per workspace.
- Error tracking, analytics and payment processing are **not** subprocessors yet because
  they are not integrated. Add them here in the same commit that adds the integration.
