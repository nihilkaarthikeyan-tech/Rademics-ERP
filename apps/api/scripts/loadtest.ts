/**
 * Local load smoke test (Spec §11, phase.md Phase 10).
 *
 * Drives the running API at ~100 concurrent connections (the §11 target) against a
 * public and an authenticated endpoint, and asserts it holds up: zero errors, no
 * non-2xx, and a p99 latency ceiling. This is a LOCAL smoke test, not a substitute
 * for the staged 100-user load test on production-like hardware — it proves the app
 * doesn't fall over under concurrency on a dev box.
 *
 * Run (API + docker stack up): pnpm --filter @rademics/api loadtest
 * Tunables: LOAD_CONNECTIONS (default 100), LOAD_DURATION seconds (default 15),
 *           LOAD_P99_MS ceiling (default 750).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const autocannon = require('autocannon');

const ORIGIN = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;
const BASE = `${ORIGIN}/api`;
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 100);
const DURATION = Number(process.env.LOAD_DURATION ?? 15);
const P99_CEILING_MS = Number(process.env.LOAD_P99_MS ?? 750);

interface AcResult {
  requests: { average: number; total: number };
  latency: { average: number; p99: number; max: number };
  throughput: { average: number };
  non2xx: number;
  errors: number;
  timeouts: number;
  '2xx': number;
}

function run(title: string, url: string, opts: Record<string, unknown> = {}): Promise<AcResult> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      { url, connections: CONNECTIONS, duration: DURATION, ...opts },
      (err: Error | null, result: AcResult) => (err ? reject(err) : resolve(result)),
    );
    autocannon.track(instance, { renderProgressBar: true, renderResultsTable: false });
    console.log(`\n▶ ${title} — ${CONNECTIONS} connections × ${DURATION}s`);
  });
}

async function login(): Promise<string | null> {
  const email = process.env.LOAD_EMAIL ?? 'admin.demo@rademics.local';
  const password = process.env.LOAD_PASSWORD ?? process.env.DEMO_PASSWORD ?? 'Demo1234!';
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json: any = await res.json();
    return json?.accessToken ?? null;
  } catch {
    return null;
  }
}

function report(title: string, r: AcResult): boolean {
  const ok = r.errors === 0 && r.non2xx === 0 && r.timeouts === 0 && r.latency.p99 <= P99_CEILING_MS;
  console.log(
    `  ${ok ? '✓' : '✗'} ${title}: ${Math.round(r.requests.average)} req/s · ` +
      `p99 ${r.latency.p99}ms · max ${r.latency.max}ms · 2xx=${r['2xx']} non2xx=${r.non2xx} ` +
      `errors=${r.errors} timeouts=${r.timeouts}`,
  );
  return ok;
}

async function main(): Promise<void> {
  console.log(`Load smoke test against ${BASE}`);

  const health = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!health) {
    console.error('✗ API not reachable — start the stack + API first.');
    process.exit(1);
  }

  const results: boolean[] = [];

  // 1. Public health endpoint — raw throughput floor.
  results.push(report('GET /health', await run('GET /health', `${BASE}/health`)));

  // 2. Authenticated read — realistic hot path through the guards + Prisma.
  const token = await login();
  if (token) {
    results.push(
      report(
        'GET /notifications (auth)',
        await run('GET /notifications (auth)', `${BASE}/notifications`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
  } else {
    console.log('  ⚠ skipped auth path — could not log in (run `demo:seed` first).');
  }

  const allOk = results.every(Boolean);
  console.log(`\n${allOk ? '✅' : '❌'} Load smoke test ${allOk ? 'passed' : 'FAILED'} ` +
    `(0 errors + p99 ≤ ${P99_CEILING_MS}ms required).`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
