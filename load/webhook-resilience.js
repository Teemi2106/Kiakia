// k6 load test: apps/web/src/app/api/webhooks/monnify/route.ts under a
// flood of traffic with INVALID signatures — a public payment webhook is a
// realistic target for scanners/fuzzers hammering it with garbage, and it
// must reject that traffic cheaply (401, no DB hit, no crash) rather than
// degrade. This is deliberately the hostile-traffic scenario, not the
// happy path: a genuine successful capture needs a real Monnify sandbox
// transaction and a matching pre-placed order per request, which isn't
// something this script can manufacture at load-test volume. To load-test
// the happy path yourself: pre-seed N draft orders with matching
// `payments.idempotency_key` rows, obtain N real Monnify sandbox
// transaction references, and sign each payload with your real
// MONNIFY_API_SECRET (see lib/monnify.ts's verifyWebhookSignature).
//
// NOT executable in this sandbox: no k6 binary, no reachable deployment.
//
//   k6 run load/webhook-resilience.js
//   k6 run -e TARGET_URL=https://staging.kiakia.app load/webhook-resilience.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";
const WEBHOOK_PATH = "/api/webhooks/monnify";

const unexpectedStatusRate = new Rate("unexpected_status");

export const options = {
  scenarios: {
    invalid_signature_flood: {
      executor: "constant-arrival-rate",
      rate: 50, // 50 requests/sec sustained
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    // The endpoint must reject every one of these fast and cleanly — a
    // 401 in under 300ms at p95 even under load, and NEVER a 500 (a 500
    // here would mean the signature check itself is throwing under load,
    // not just correctly rejecting).
    http_req_duration: ["p(95)<300"],
    unexpected_status: ["rate<0.001"],
  },
};

function randomPayload() {
  return JSON.stringify({
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      transactionReference: `load-test-${Math.random().toString(36).slice(2)}`,
      paymentReference: `KK-LOAD-${Math.floor(Math.random() * 1_000_000)}`,
    },
  });
}

export default function () {
  const body = randomPayload();
  const res = http.post(TARGET_URL + WEBHOOK_PATH, body, {
    headers: {
      "Content-Type": "application/json",
      // Deliberately wrong — this is the point of this script (see file header).
      "monnify-signature": "0".repeat(128),
    },
  });

  const ok = check(res, {
    "rejected with 401 (not 500, not a hang)": (r) => r.status === 401,
  });
  unexpectedStatusRate.add(!ok);

  sleep(0); // constant-arrival-rate controls pacing, not this loop
}
