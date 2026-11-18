"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { api, money } from "../lib/client";
import { Badge, Button } from "./UI";

/**
 * The plan tab is driven by `GET /api/billing`, which is the only source of prices
 * and limits. Before this existed, Settings showed "Community / Free" while the
 * marketing modal advertised ₹101 / ₹499 / ₹1,499 — three price lists, none of them
 * the one the server enforced.
 */

type PlanView = {
  id: string;
  name: string;
  monthlyCents: number;
  annualCents: number;
  seats: number;
  aiQuestionsPerMonth: number;
  storageBytes: number;
  activeWorkflows: number;
  summary: string;
  features: string[];
  current: boolean;
};

type BillingView = {
  billingEnabled: boolean;
  provider: string | null;
  subscription: { plan: string; planName: string; status: string; active: boolean; currentPeriodEnd: string | null; cancelAt: string | null; graceUntil: string | null };
  limits: { seats: number; aiQuestionsPerMonth: number; storageBytes: number; activeWorkflows: number };
  usage: { seats: number; aiQuestions: number; storageBytes: number; activeWorkflows: number };
  plans: PlanView[];
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

function formatBytes(bytes: number) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

function usageLine(label: string, used: number, limit: number) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const atLimit = limit > 0 && used >= limit;
  return (
    <div key={label} className="plan-usage-row" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>{label}</span>
        <strong aria-label={`${label}: ${used} of ${limit}`}>{used} / {limit}</strong>
      </div>
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label} usage`}
        style={{ height: 6, borderRadius: 999, background: "var(--surface-3, #e5e7eb)", overflow: "hidden" }}
      >
        <div style={{ width: `${ratio * 100}%`, height: "100%", background: atLimit ? "#dc2626" : "var(--accent, #6366f1)" }} />
      </div>
    </div>
  );
}

export function BillingPanel({ toast, compact = false }: { toast?: (message: string) => void; compact?: boolean }) {
  const [data, setData] = useState<BillingView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<BillingView>("/api/billing")
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load your plan."); });
    return () => { cancelled = true; };
  }, []);

  async function choose(planId: string) {
    setBusy(planId); setNotice(""); setError("");
    try {
      const result = await api<{ url?: string | null; notice?: string; status?: string }>("/api/billing/checkout", "POST", { plan: planId });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setNotice(result.notice ?? "Checkout is recorded. No card is charged in this release.");
      toast?.(result.notice ?? "Checkout recorded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start checkout.");
    } finally { setBusy(""); }
  }

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!data) {
    return <div className="settings-notice" role="status"><Loader2 size={18} /><p>Loading your plan…</p></div>;
  }

  const { subscription, usage, limits, plans, billingEnabled } = data;

  return (
    <div>
      {!compact && (
        <div className="settings-section-header">
          <h2>Your plan</h2>
          <p>What you are on, what it includes, and what you are using.</p>
        </div>
      )}

      <div className="current-plan">
        <span className="soft-icon"><Sparkles size={25} /></span>
        <div>
          <span>YOUR CURRENT PLAN</span>
          <h3>{subscription.planName}</h3>
          <p>
            {subscription.status === "past_due" ? "A payment failed; access continues during the grace period."
              : subscription.status === "canceled" ? "Cancelled — access continues until the period ends."
                : subscription.status === "trialing" ? "Trial in progress."
                  : "Active."}
            {subscription.currentPeriodEnd ? ` Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}.` : ""}
          </p>
        </div>
        <strong>{money(plans.find((plan) => plan.id === subscription.plan)?.monthlyCents ?? 0)}<span>per month</span></strong>
      </div>

      <div style={{ marginTop: 18 }}>
        {usageLine("Seats", usage.seats, limits.seats)}
        {usageLine("AI questions this month", usage.aiQuestions, limits.aiQuestionsPerMonth)}
        {usageLine("Documents", Math.round(usage.storageBytes / MB), Math.round(limits.storageBytes / MB))}
        {usageLine("Active automations", usage.activeWorkflows, limits.activeWorkflows)}
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          Documents used: {formatBytes(usage.storageBytes)} of {formatBytes(limits.storageBytes)}.
        </p>
      </div>

      {notice && <div className="settings-notice" role="status"><Check size={18} /><p>{notice}</p></div>}

      <div className="pricing-grid" style={{ marginTop: 20 }}>
        {plans.map((plan) => (
          <div className={`pricing-card ${plan.current ? "selected" : ""}`} key={plan.id}>
            {plan.id === "growth" && !plan.current && <span className="pricing-popular">MOST POPULAR</span>}
            <h3>{plan.name}</h3>
            <strong>{money(plan.monthlyCents)}</strong>
            <span>per month · {plan.seats} seats</span>
            <p>{plan.summary}</p>
            <ul className="plan-features">
              {plan.features.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}
            </ul>
            {plan.current ? (
              <Badge>Current plan</Badge>
            ) : (
              <Button
                variant={plan.monthlyCents === 0 ? "secondary" : "primary"}
                busy={busy === plan.id}
                disabled={!billingEnabled || Boolean(busy)}
                onClick={() => void choose(plan.id)}
              >
                {billingEnabled ? `Choose ${plan.name}` : `${plan.name} — billing disabled`}<ArrowRight size={14} />
              </Button>
            )}
          </div>
        ))}
      </div>

      {!billingEnabled && (
        <div className="settings-notice" role="note">
          <Sparkles size={18} />
          <p>
            Billing is not enabled on this deployment, so nothing here can charge a card and every workspace stays on the
            free plan. Prices and limits above are the real catalogue the server enforces.
          </p>
        </div>
      )}
    </div>
  );
}
