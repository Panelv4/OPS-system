/**
 * Runs once when the Next.js server boots (Node.js runtime only).
 * Validates security-relevant configuration so a misconfigured deployment
 * fails at startup instead of serving traffic with unsafe defaults.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateConfig, ConfigError } = await import("./opspilot/server/config");
  try {
    validateConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : "Unknown configuration error.";
    console.error(`[config] Startup aborted: ${message}`);
    throw error;
  }
}
