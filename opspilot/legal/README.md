# Legal documents (drafts)

These are **drafts written by an engineer, not by a lawyer**, and they are not published
anywhere. Do not paste them into the product, a signup flow or an invoice until a
qualified lawyer in the operating jurisdiction has reviewed them (T-603).

What is here:

| File | Purpose | Status |
| --- | --- | --- |
| `PRIVACY_POLICY.md` | what is collected, why, where, for how long, how to delete it | draft, unreviewed |
| `TERMS_OF_SERVICE.md` | the contract: acceptable use, billing, liability, termination | draft, unreviewed |
| `DPA.md` | data-processing terms for business customers who are controllers | draft, unreviewed |
| `SUBPROCESSORS.md` | every third party that can touch customer data | draft — must match reality |

Two rules for whoever edits these:

1. **Never describe a control the code does not have.** If the policy says "we delete
   data within 30 days", a task must exist to make that true (today: account deletion is
   immediate and cascades; audit rows go with the workspace).
2. **Every subprocessor entry must have a matching environment variable or config path.**
   If there is no `RESEND_API_KEY` in production, Resend is not a subprocessor yet.
