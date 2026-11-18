/**
 * Commercial configuration for OpsPilot plans.
 *
 * Prices and quotas live here — never inline in components — so that pricing
 * experiments are a one-file change. Amounts are integer minor units (cents) to
 * match the rest of the codebase's money handling.
 *
 * These are *hypotheses* to validate with customers, not validated facts. The
 * INR figures use the planning rate below and are display-only; settlement
 * currency is decided by the payment provider, not by this file.
 */

export const PLAN_IDS = ["free", "starter", "growth", "scale"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in USD cents. 0 for the free plan. */
  monthlyCents: number;
  /** Annual price in USD cents; ~17% below 12× monthly. */
  annualCents: number;
  seats: number;
  /** AI questions per calendar month (provider tokens are recorded separately). */
  aiQuestionsPerMonth: number;
  storageBytes: number;
  activeWorkflows: number;
  summary: string;
  features: string[];
};

/** Planning exchange rate for INR display only. Not a settlement rate. */
export const INR_PER_USD = 87;

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyCents: 0,
    annualCents: 0,
    seats: 2,
    aiQuestionsPerMonth: 50,
    storageBytes: 250 * MB,
    activeWorkflows: 5,
    summary: "Everything you need to run one small team.",
    features: ["Core CRM, invoicing and projects", "Local insights", "250 MB documents"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyCents: 2900,
    annualCents: 28900,
    seats: 5,
    aiQuestionsPerMonth: 300,
    storageBytes: 2 * GB,
    activeWorkflows: 15,
    summary: "For a small team taking on its first clients.",
    features: ["5 seats", "300 AI questions / month", "2 GB documents", "15 automations"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyCents: 5900,
    annualCents: 58900,
    seats: 15,
    aiQuestionsPerMonth: 1000,
    storageBytes: 10 * GB,
    activeWorkflows: 40,
    summary: "For agencies running many client projects at once.",
    features: ["15 seats", "1,000 AI questions / month", "10 GB documents", "40 automations"],
  },
  scale: {
    id: "scale",
    name: "Scale",
    monthlyCents: 11900,
    annualCents: 118900,
    seats: 40,
    aiQuestionsPerMonth: 4000,
    storageBytes: 50 * GB,
    activeWorkflows: 150,
    summary: "For established agencies with several teams.",
    features: ["40 seats", "4,000 AI questions / month", "50 GB documents", "150 automations"],
  },
};

export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Resolves a plan, falling back to the free plan for unknown values. */
export function planFor(id: string | null | undefined): Plan {
  return isPlanId(id) ? PLANS[id] : PLANS[DEFAULT_PLAN];
}

/**
 * Monthly price for a plan, with an optional environment override so a founder
 * can run a pricing experiment without a code change or a redeploy of the UI.
 * Returns cents. Invalid overrides are ignored and logged.
 */
export function planPriceCents(id: PlanId, env: Record<string, string | undefined> = process.env): number {
  const base = PLANS[id].monthlyCents;
  const raw = env[`PLAN_PRICE_${id.toUpperCase()}_CENTS`];
  if (raw === undefined || raw === "") return base;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    console.warn(`[plans] Ignoring invalid PLAN_PRICE_${id.toUpperCase()}_CENTS="${raw}".`);
    return base;
  }
  return parsed;
}

/** Formats cents as USD/INR for display. Whole units only — plan prices are never fractional. */
export function formatPlanPrice(cents: number, currency: "USD" | "INR" = "USD"): string {
  const units = currency === "INR" ? Math.round((cents / 100) * INR_PER_USD) : Math.round(cents / 100);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(units);
}

export type QuotaKind = "ai" | "storage" | "workflows" | "seats";

export type Limits = {
  seats: number;
  aiQuestionsPerMonth: number;
  storageBytes: number;
  activeWorkflows: number;
};

export function limitsFor(plan: Plan): Limits {
  return {
    seats: plan.seats,
    aiQuestionsPerMonth: plan.aiQuestionsPerMonth,
    storageBytes: plan.storageBytes,
    activeWorkflows: plan.activeWorkflows,
  };
}

/** Human-readable quota label used in error messages. */
export function quotaLabel(kind: QuotaKind, limit: number): string {
  switch (kind) {
    case "ai":
      return `${limit} AI questions per month`;
    case "storage":
      return `${(limit / MB).toFixed(0)} MB of documents`;
    case "workflows":
      return `${limit} active automations`;
    case "seats":
      return `${limit} team members`;
  }
}
