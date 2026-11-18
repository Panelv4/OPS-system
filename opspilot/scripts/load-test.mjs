#!/usr/bin/env node
/**
 * Minimal load test for the API surface (T-305).
 *
 * No dependency, no paid tooling: real HTTP against a running server, a fixed number of
 * concurrent workers, and p50/p95/p99 plus error counts. Use a disposable database —
 * it registers workspaces.
 *
 *   TEST_BASE_URL=http://localhost:3000 node opspilot/scripts/load-test.mjs --users 50 --requests 400
 */

const base = (process.env.TEST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
};
const USERS = Math.max(1, arg("users", 50));
const REQUESTS = Math.max(USERS, arg("requests", 400));
const PASSWORD = "A-good-test-password-2026!";

const durations = [];
const errors = new Map();
let completed = 0;

async function timed(label, fn) {
  const started = performance.now();
  try {
    const status = await fn();
    durations.push(performance.now() - started);
    if (status >= 400) errors.set(`${label}:${status}`, (errors.get(`${label}:${status}`) ?? 0) + 1);
    return status;
  } catch (error) {
    durations.push(performance.now() - started);
    const key = `${label}:network`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
    return 0;
  } finally {
    completed += 1;
  }
}

async function session() {
  const email = `load-${crypto.randomUUID()}@example.com`;
  const register = await fetch(`${base}/api/session/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password: PASSWORD, name: "Load Test", workspace: `Load ${email.slice(5, 13)}` }),
  });
  const cookie = (register.headers.getSetCookie() ?? []).find((value) => value.startsWith("opspilot_session="))?.split(";")[0];
  return { cookie, status: register.status };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

(async () => {
  console.log(`Target ${base} · ${USERS} concurrent sessions · ${REQUESTS} requests`);
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error("Server is not reachable at", base);
    process.exit(1);
  }

  const clients = [];
  const startedAt = performance.now();
  // Register the sessions first so read load measures reads, not signup hashing.
  const signupStart = performance.now();
  for (let index = 0; index < USERS; index += 1) {
    const created = await session();
    clients.push(created);
    if (created.status !== 201) errors.set(`register:${created.status}`, (errors.get(`register:${created.status}`) ?? 0) + 1);
  }
  const signupMs = performance.now() - signupStart;

  const reads = REQUESTS - USERS;
  let issued = 0;
  const readStart = performance.now();
  async function worker(client) {
    while (issued < reads) {
      issued += 1;
      const n = issued % 4;
      const path = n === 0 ? "/api/workspace" : n === 1 ? "/api/members" : n === 2 ? "/api/billing" : "/api/health";
      await timed(path, async () => (await fetch(`${base}${path}`, { headers: { Cookie: client.cookie } })).status);
    }
  }
  await Promise.all(clients.map((client) => worker(client)));
  const readMs = performance.now() - readStart;
  const totalMs = performance.now() - startedAt;

  const okRequests = durations.length - [...errors.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({
    users: USERS,
    requests: durations.length,
    ok: okRequests,
    errors: Object.fromEntries(errors),
    signupMs: Math.round(signupMs),
    readPhaseMs: Math.round(readMs),
    wallClockMs: Math.round(totalMs),
    readThroughputPerSecond: Number((durations.length / (readMs / 1000)).toFixed(1)),
    latencyMs: {
      p50: Math.round(percentile(durations, 50)),
      p95: Math.round(percentile(durations, 95)),
      p99: Math.round(percentile(durations, 99)),
      max: Math.round(Math.max(...durations)),
    },
  }, null, 2));

  if (errors.size > 0 && [...errors.keys()].some((key) => !key.endsWith(":429"))) process.exitCode = 1;
})();
