/**
 * Central runtime configuration.
 *
 * Security-relevant settings are resolved and validated in one place so that a
 * misconfigured deployment fails loudly and early instead of silently running
 * with weaker defaults.
 */

export class ConfigError extends Error {}

/** Loosely typed environment bag so tests can pass plain objects. */
export type EnvBag = Record<string, string | undefined>;

export type BillingProviderId = "test" | "stripe";

export type OpsConfig = {
  databaseUrl: string;
  billingProvider: BillingProviderId | "";
  billingWebhookSecret: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  aiEnabled: boolean;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  isProduction: boolean;
};

const TRUE = new Set(["true", "1", "yes", "on"]);
const FALSE = new Set(["false", "0", "no", "off", ""]);

function parseFlag(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (TRUE.has(value)) return true;
  if (FALSE.has(value)) return false;
  throw new ConfigError(`${name} must be "true" or "false" (received "${raw}").`);
}

/**
 * Pure resolver: takes an environment bag, returns validated configuration.
 * Throwing here is intentional — callers decide when to surface it.
 */
export function resolveConfig(env: EnvBag = process.env): OpsConfig {
  const isProduction = env.NODE_ENV === "production";

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new ConfigError("DATABASE_URL is required.");
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new ConfigError("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
  }

  const cookieSecureFlag = parseFlag("COOKIE_SECURE", env.COOKIE_SECURE);
  const trustProxy = parseFlag("TRUST_PROXY", env.TRUST_PROXY) ?? false;
  const aiEnabled = parseFlag("AI_ENABLED", env.AI_ENABLED) ?? false;

  const openaiApiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (aiEnabled && !openaiApiKey) {
    throw new ConfigError("AI_ENABLED=true requires OPENAI_API_KEY. Unset AI_ENABLED to use local insights only.");
  }
  if (aiEnabled && !openaiApiKey.startsWith("sk-")) {
    // Providers compatible with the OpenAI API may use other key formats; warn only.
    console.warn("[config] OPENAI_API_KEY does not look like an OpenAI key. Verify the provider and key.");
  }

  const rawProvider = (env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  if (rawProvider && rawProvider !== "test" && rawProvider !== "stripe") {
    throw new ConfigError('BILLING_PROVIDER must be "test", "stripe", or unset (billing disabled).');
  }
  const billingProvider = rawProvider as BillingProviderId | "";
  const billingWebhookSecret = (env.BILLING_WEBHOOK_SECRET ?? "").trim();
  if (billingProvider && billingWebhookSecret.length < 16) {
    // Fail closed: without a secret, unsigned callbacks would be indistinguishable
    // from revenue, which is exactly the mistake that grants free entitlements.
    throw new ConfigError("BILLING_WEBHOOK_SECRET (16+ characters) is required when BILLING_PROVIDER is set.");
  }

  const openaiBaseUrl = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  if (aiEnabled && !/^https:\/\//.test(openaiBaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(openaiBaseUrl)) {
    throw new ConfigError("OPENAI_BASE_URL must use https:// (plain http is only allowed for localhost).");
  }

  return Object.freeze({
    databaseUrl,
    billingProvider,
    billingWebhookSecret,
    cookieSecure: cookieSecureFlag ?? isProduction,
    trustProxy,
    aiEnabled,
    openaiApiKey,
    openaiBaseUrl,
    openaiModel: env.OPENAI_MODEL ?? "gpt-4o-mini",
    isProduction,
  });
}

let cached: OpsConfig | undefined;

/** Memoised accessor for request-time use. */
export function config(): OpsConfig {
  cached ??= resolveConfig();
  return cached;
}

/**
 * Fail-fast validation for server startup. Called from instrumentation.ts.
 * Returns the resolved configuration and prints actionable warnings.
 */
export function validateConfig(env: EnvBag = process.env): OpsConfig {
  const resolved = resolveConfig(env);
  const warnings: string[] = [];

  if (resolved.isProduction && !resolved.cookieSecure) {
    warnings.push("COOKIE_SECURE=false in production: session cookies will be sent over plain HTTP. Terminate TLS and enable secure cookies before launch.");
  }
  if (!resolved.billingProvider) {
    warnings.push("Billing is disabled (BILLING_PROVIDER unset): workspaces resolve to the free plan and checkout returns 503. Expected for self-hosted use.");
  }
  if (!resolved.trustProxy) {
    warnings.push("TRUST_PROXY=false: forwarded headers are ignored, so per-client rate limiting is disabled and only per-account limits apply. Set TRUST_PROXY=true behind a proxy you control (Vercel, Cloudflare, nginx).");
  }

  for (const warning of warnings) console.warn(`[config] ${warning}`);
  return resolved;
}

/**
 * Picks the rate-limit bucket for an anonymous action.
 *
 * With a trusted proxy the bucket is per client address. Without one the
 * address cannot be trusted, so the limiter deliberately falls back to a single
 * global bucket instead of pretending per-client isolation: that keeps the
 * quota honest, and the per-account limits (email, user id) still bound abuse.
 */
export function rateLimitKey(scope: "auth" | "demo", ip: string, trustProxy: boolean): string {
  return trustProxy ? `${scope}:${ip}` : `${scope}:global`;
}

/**
 * Resolves the client address used for rate limiting.
 *
 * Forwarded headers are attacker-controlled unless a trusted proxy overwrites
 * them, so they are only honoured when TRUST_PROXY is enabled.
 */
export function clientIp(request: Request, resolved: OpsConfig = config()): string {
  if (resolved.trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first && first.length <= 45) return first;
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp && realIp.length <= 45) return realIp;
  }
  return "direct-client";
}
