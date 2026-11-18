# Zero-budget go-to-market (T-605)

Written 2026-11-18. Nothing here spends money, and nothing here should be executed as an
automated outreach campaign — every outbound message is sent by a human, one at a time,
from a human address. Loops, mass DMs and scraped lists are how a new product earns a
domain reputation problem before it earns a customer.

**Precondition:** the launch gates in `PRODUCTION_READINESS.md` must be GREEN first, or
this plan sends strangers into a product that cannot email them a password reset.

---

## 1. Who to talk to first (20 people, not 2,000)

From `MARKET_RESEARCH.md` §4: English-speaking 3–20 person digital/creative agencies and
consultancies. The reachable sub-segment for a founder with no audience:

1. Agencies already complaining in public — search for "Productive too expensive",
   "Scoro minimum seats", "spreadsheet invoicing" on Reddit (r/agency, r/webdev,
   r/smallbusiness), Indie Hackers and X. These are warm: they described the problem.
2. Freelancer-to-agency transitions (2–5 people, first hire) — they are choosing tooling
   *now*, and seat minimums actively repel them.
3. Agencies posting "we use Notion + spreadsheets" in their own marketing — a public
   signal that the back office is unowned.

Do **not** start with 40-seat shops: OpsPilot has no SSO, no client portal and no time
tracking, and those buyers will disqualify it in ten minutes (see §5 of the research).

## 2. The offer

- **Free plan, no card**: 2 seats, 50 AI questions, 250 MB — enough to run one real
  project.
- **Founding-customer deal (first 10 workspaces only)**: 50% off Growth for 12 months,
  in exchange for a 20-minute call every two weeks. State the limit; honour it.
- **No fake scarcity, no fake reviews, no invented logos.** The product page says what it
  is: new, small, built by one person, with a public changelog.

## 3. The 30-day sequence (all free)

| Week | Action | Output |
| --- | --- | --- |
| 0 | Ship the launch gates; publish the demo workspace link; write one honest "what it does / what it doesn't" page | a URL that survives scrutiny |
| 1 | 10 personal emails to the public complainers (1 paragraph, a link, a question — no deck) | 3–5 replies |
| 2 | Post one build-in-public thread: "I rebuilt the agency back office; here's the invoice model" with a screenshot and the trade-offs | 1 post, owned by the founder |
| 3 | 5 more emails + 3 communities (r/agency self-promo thread if allowed, Indie Hackers, one Slack/Discord where the founder is already a member) | 2 calls booked |
| 4 | Run 2 calls; change one thing in the product from what they said; write it up | a public changelog entry + 1 paying-intent signal |

**Targets to judge the plan by** (honest, small): 20 emails → ≥5 replies → ≥3 calls →
≥1 paid workspace in 60 days. If 20 emails produce zero replies, the *message* is wrong,
not the volume.

## 4. The demo that does the selling

`/login?mode=demo` creates a disposable workspace with sample data. The pitch is the first
five minutes inside it:

1. Open Customers → the client list with real subtotals.
2. Create an invoice from a customer, mark a payment, watch the balance drop.
3. Upload a receipt to Documents and attach it to an expense.
4. Ask the AI analyst "which clients are overdue and by how much?" — and get numbers that
   match the invoice list.
5. Show an automation firing a notification.

If any step needs explaining for more than ten seconds, that step is the next UX ticket.

## 5. Content that compounds (one per fortnight, not daily)

Topics that a 5–20 person agency actually searches for:

- "What a 5-person agency actually pays for project management software" (the seat-minimum
  maths from `MARKET_RESEARCH.md`, with sources and dates)
- "Invoice numbering, tax and late fees for a small agency" (no tax advice — the mechanics)
- "Moving off spreadsheets without losing history" (bridges to CSV import, T-507)
- "What we store, where, and how to delete it" (the privacy page as marketing)

Each piece ends with the demo link, not with a signup wall.

## 6. Product Hunt / directories (one shot, later)

Do it once the demo is stable and the free plan can carry a spike of anonymous signups.
Preparation: 6 screenshots, a 30-second screen recording, a founder comment that explains
the *honest* limitations, and a plan for the traffic (rate limits, demo TTL, support
inbox). Launch on a Tuesday–Thursday, and have the changelog entry ready so a "what's
new" response exists for every comment.

## 7. What is explicitly out of scope

- Paid ads, influencers, purchased lists, cold-email tooling.
- Review-site placements or testimonials before there are real customers.
- Any claim about compliance, payroll, tax filing or security certification.
- Automated outreach of any kind. If a message cannot be sent by hand, it does not ship.

## 8. Measure (T-502/T-503 dependency)

Until activation events exist, measure by hand in a spreadsheet: signups, demo sessions,
first record created, first invoice sent, first invite accepted, paid conversions. Those
five numbers decide what to build next; page views do not.
