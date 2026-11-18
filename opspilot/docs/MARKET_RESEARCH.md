# Market research and positioning (T-601, T-602)

Written 2026-11-18. Every price below is quoted from a public source listed at the end;
where two sources disagree the range is shown rather than a single "fact". Prices move —
re-check before quoting any of this to a customer.

---

## 1. What OpsPilot actually is, in market terms

An all-in-one back-office for a small service business: customers, invoices, expenses,
vendors, inventory, documents, HR records, an AI analyst and automations, in one
tenant-scoped workspace. That puts it in the same conversation as **Productive** and
**Scoro** (agency PSA), **Zoho Books / Zoho One** (cloud accounting + suite) and
**ERPNext / Odoo Community** (self-hosted open-source ERP).

It is *not* a general ledger: there is no double-entry accounting, no bank
reconciliation, no tax filing. That is a positioning constraint, not a detail to paper
over — see §5.

## 2. Competitor pricing (checked November 2026)

| Vendor | Model | Published price | Seat floor | Free tier |
| --- | --- | --- | --- | --- |
| **Productive.io** | per user/month, annual | Essential ≈ $10–11, Professional ≈ $25–28, Ultimate ≈ $33–39 | 3 seats | no; 14-day trial |
| **Scoro** | per user/month, annual, sold as app bundles | $17–19.90 (time/billing only) up to $57–71 (end-to-end) | 5 seats | no; 14-day trial |
| **Zoho Books** | per *organisation* /month | Free (1 user + 1 accountant, revenue cap $50K); Standard $15–20 (3 users); Professional $40–50 (5 users); Premium $60–70 (10 users); Ultimate $240–275 (15 users) | n/a (per-org) | yes, revenue-capped |
| **Odoo** | per user/month, all apps | Community free (self-hosted); Standard ≈ $25–31; Custom ≈ $47–61 | none published | Community edition |
| **ERPNext** | open source | software $0; real cost is hosting + ops (managed Frappe Cloud tiers ≈ $50/user/mo at the tiers businesses use) | n/a | yes, self-hosted |

**What the numbers say.** A 10-person agency pays roughly:

- Productive Professional: 10 × $28 = **$280/mo** (≈ $3,360/yr)
- Scoro Essential: 5-seat minimum × $28 = **$140/mo floor**, and $280/mo at 10 seats
- Zoho Books Premium: **$60–70/mo for 10 users** — an order of magnitude cheaper than
  the agency PSAs, because it is accounting, not delivery management
- Odoo Standard: 10 × $31 = **$310/mo**, plus an implementation project that vendors
  describe as starting around $5,000–15,000
- ERPNext: **$0 licence**, plus the DevOps time nobody prices

**Seat minimums are the small-shop tax.** Productive's 3-seat floor and Scoro's 5-seat
floor mean a two-person studio pays for empty seats. Zoho's per-organisation model is
the only one that fits a 3-person shop.

## 3. Where OpsPilot's plans sit

Current catalogue (test mode, no charge can occur):

| Plan | Price | Seats | AI questions/mo | Documents | Automations |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | 2 | 50 | 250 MB | 5 |
| Starter | $29 | 5 | 300 | 2 GB | 15 |
| Growth | $59 | 15 | 1,000 | 10 GB | 40 |
| Scale | $119 | 40 | 4,000 | 50 GB | 150 |

- **Starter at $29 for 5 seats** undercuts Productive (5 × $11 = $55 at Essential, and
  Essential excludes resource planning) and sits inside Scoro's floor price for one
  seat. It is deliberately cheaper than the PSA incumbents because OpsPilot has no
  time-tracking or resource planning yet (T-504) — the price is honest about the gap.
- **Growth at $59 for 15 seats** is roughly one-fifth of Productive Professional at the
  same seat count ($420/mo), which is only defensible while the product is thinner.
  Expect to raise this once time tracking + project profitability ship.
- **Scale at $119 for 40 seats** competes with nothing directly; at 40 seats the
  incumbents charge $1,000–$2,200/mo. This is the tier that will need the most proof
  (audit log export, SSO, per-document ACLs) before anyone signs.

**Pricing risk to state plainly:** if a customer's real need is bookkeeping, they should
buy Zoho Books at $20/mo, not OpsPilot. OpsPilot only wins when the same person must
also track clients, quotes, stock, documents and internal automations in one place.

## 4. Primary and secondary market (T-602 recommendation)

**Primary: English-speaking, 3–20 person digital/creative agencies and consultancies in
the US, UK, Canada and Australia.**

Why this one, with evidence:

1. **The incumbents price them out at the low end.** A 5-person shop on Scoro pays a
   5-seat minimum at $28+/user; on Productive it pays a 3-seat minimum plus a plan that
   gates resource planning. There is a visible gap between "spreadsheet + Gmail" and
   "$280/month per 10 people".
2. **They buy software online without a sales call.** Zoho's per-organisation pricing
   ($15–70/mo) proves this segment self-serves; the PSAs' 14-day trials and 4–8 week
   onboarding (Scoro) prove the middle is heavy.
3. **USD/GBP/AUD/CAD pricing and English-only UI** means no localisation project before
   launch. OpsPilot already prices in USD and formats money in USD/INR.

**Secondary: India (INR) — the founder's home market, cheapest to reach from zero.**

India is where a $29 plan is a *high* price, so the entry must be either the free plan
or a materially lower Starter. The product is not GST-compliant and does not produce
e-invoices, which is a hard requirement for most Indian SMBs; treat India as a
"free plan + services" market until tax localisation exists.

**Explicitly not first:** Germany/France (mandatory e-invoicing and accounting
localisation), and any market requiring payroll or statutory filings.

## 5. Honest gaps that a sales conversation will hit

| Gap | Consequence | Tracked |
| --- | --- | --- |
| No double-entry ledger, no bank reconciliation | Any prospect with an accountant will ask; answer "we sit beside your accounting tool", not "we replace it" | — |
| No time tracking or project profitability | The single biggest functional gap versus Productive/Scoro | T-504 |
| No client portal | Agencies share invoices/approvals with clients | T-505 |
| No CSV import | Migration from spreadsheets is the #1 onboarding objection | T-507 |
| Documents are stored in Postgres, not object storage | Cost and scale ceiling once workspaces hold real files | T-301 |
| No SSO/SAML | Blocks sales to 40+ seat buyers (Scale tier) | not yet a task |

## 6. What to build next, in market order

1. **T-507 CSV import** — kills the largest onboarding objection for a spreadsheet user.
2. **T-504 time tracking + budgets** — closes the only gap that justifies the price gap
   vs Zoho Books.
3. **T-506 recurring invoices** — agencies bill retainers; without it the invoice module
   is a demo.
4. **T-505 client portal** — turns invoices into something a client interacts with.
5. **T-301 object storage** — before any workspace stores real client contracts.

---

## Sources

- Productive / Scoro / Teamwork / Accelo pricing and seat minimums:
  [agiled.app — 12 best all-in-one platforms (Apr 2026)](https://agiled.app/blog/best-all-in-one-software-for-agencies),
  [agiled.app — dev agencies (Apr 2026)](https://agiled.app/blog/best-all-in-one-software-for-software-development-agencies),
  [scribbl.co — agency PM tools (Jun 2026)](https://scribbl.co/post/agency-project-management-tools),
  [getparallax.com — resource planning (Nov 2026)](https://www.getparallax.com/resources/resource-planning-tools-for-agencies/)
- Zoho Books tiers, free plan and per-organisation model:
  [auditfriendly.co — Zoho Books review](https://www.auditfriendly.co/software/zoho-books),
  [ecosire.com — Zoho Books vs Odoo (Aug 2026)](https://ecosire.com/blog/odoo-accounting-vs-zoho-books-2026-comparison),
  [theledgerlabs.com — Odoo vs Zoho (Oct 2026)](https://theledgerlabs.com/odoo-vs-zoho/)
- Odoo Community/Enterprise and ERPNext (software free, hosting/ops costs):
  [nonari.io — ERPNext alternatives (Nov 2026)](https://nonari.io/blog/why-smbs-bounce-off-erpnext),
  [octurasolutions.com — ERPNext alternatives (Jul 2026)](https://octurasolutions.com/alternatives/erpnext)
- Plan catalogue and limits: `src/opspilot/lib/plans.ts` (source of truth for OpsPilot's
  own numbers).

**Caveat:** all competitor figures come from secondary comparison sites, not from the
vendors' own pricing pages, and several sources disagree by 10–30% depending on billing
period and promotions. Treat them as ranges. Before any public comparison, re-check the
vendor's own page.
