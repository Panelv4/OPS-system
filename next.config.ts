import type { NextConfig } from "next";

/**
 * Frame protection is a security default, not a preference: production builds answer
 * with `X-Frame-Options: DENY` and `frame-ancestors 'none'` so no third-party page can
 * frame the app (clickjacking, F-06).
 *
 * A sandbox preview, however, *is* an iframe on another origin. `PREVIEW_EMBED=true`
 * relaxes exactly those two directives and nothing else. Next evaluates `headers()` at
 * **build time**, so the flag must be set when running `next build`, not just when
 * starting the server — that is deliberate: it keeps the relaxation out of any build
 * that does not opt in, and it cannot be switched on at runtime by an environment
 * variable an attacker could influence.
 */
const PREVIEW_EMBED = process.env.PREVIEW_EMBED === "true";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  PREVIEW_EMBED ? "frame-ancestors *" : "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: CSP },
      // Browsers ignore HSTS delivered over plain HTTP, so this is safe in
      // local development and correct behind TLS. `preload` is deliberately
      // omitted: joining the preload list is irreversible and needs sign-off.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    // Omitted entirely in preview mode: `SAMEORIGIN` would still block a cross-origin
    // preview frame, and legacy browsers honour it over CSP's frame-ancestors.
    if (!PREVIEW_EMBED) headers.push({ key: "X-Frame-Options", value: "DENY" });
    return [{ source: "/:path*", headers }];
  },
};
export default nextConfig;
