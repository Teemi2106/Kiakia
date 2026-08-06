// k6 load test: the public marketing page (apps/web/src/app/(marketing)/page.tsx).
// Deliberately picked as the first load-test target because it's the one
// route that's genuinely public and Supabase-free by design (see that
// file's own header comment) — no auth/cookie setup needed, so it isolates
// pure Next.js rendering + hosting throughput from Supabase's.
//
// NOT executable in this sandbox: no k6 binary, and no deployed/running
// target reachable at load-test scale. Run it yourself against a real
// deployment or a local `pnpm --filter web start` (production build, not
// `next dev` — dev-mode compilation makes latency numbers meaningless):
//
//   k6 run load/marketing-page.js
//   k6 run -e TARGET_URL=https://staging.kiakia.app load/marketing-page.js
//
// Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const pageLoadDuration = new Trend("page_load_duration");

export const options = {
  scenarios: {
    ramping_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 }, // warm up
        { duration: "1m", target: 100 }, // typical launch-day traffic
        { duration: "30s", target: 300 }, // a spike — a promo post, a food blogger mention
        { duration: "1m", target: 300 }, // hold the spike
        { duration: "30s", target: 0 }, // recover
      ],
    },
  },
  thresholds: {
    // These numbers are a starting point, not a spec handed down from
    // above — tune them once you have a real baseline from a real
    // deployment. The point of having *any* threshold is that `k6 run`
    // exits non-zero on regression, so this can gate a CI/CD pipeline.
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    errors: ["rate<0.01"], // under 1% failures even at the spike
  },
};

export default function () {
  const res = http.get(TARGET_URL + "/");
  pageLoadDuration.add(res.timings.duration);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "body contains the hero headline": (r) => r.body.includes("Fast. Fresh. Reliable."),
    "response has no server error signature": (r) => !r.body.includes("Application error"),
  });
  errorRate.add(!ok);

  sleep(Math.random() * 2 + 1); // 1-3s "think time" between page views, not a hammering loop
}
