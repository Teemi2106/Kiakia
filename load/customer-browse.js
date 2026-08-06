// k6 load test: the authenticated customer browse path (/home ->
// /vendors/[slug]) — the actual hot path once a user is past login: two
// Supabase-backed Server Component reads per virtual user per iteration.
//
// Authenticating k6 virtual users against a Next.js app using
// @supabase/ssr is the fiddly part: the session has to be presented as
// the exact `sb-<project-ref>-auth-token` cookie @supabase/ssr expects,
// not a bearer header. This script gets a real session from Supabase's
// own REST auth API (no browser needed) and reconstructs that cookie by
// hand. IMPORTANT CAVEAT: @supabase/ssr's cookie encoding (the
// `base64-` prefix, chunking above ~3180 bytes into `.0`/`.1`/...
// suffixes) is an implementation detail that has changed across major
// versions and could again. The `verify: session cookie worked` check
// below is not decorative — if it fails, every subsequent request is
// silently hitting the (auth) redirect to /login instead of the page
// under test, which would make the rest of the run's numbers meaningless.
// Confirm that check passes before trusting anything else this script
// reports.
//
// NOT executable in this sandbox: no k6 binary, no reachable deployment,
// no real Supabase project. Run it yourself with real seeded test-user
// credentials:
//
//   k6 run \
//     -e TARGET_URL=https://staging.kiakia.app \
//     -e SUPABASE_URL=https://your-project.supabase.co \
//     -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
//     -e TEST_USER_EMAIL=loadtest@example.com \
//     -e TEST_USER_PASSWORD=... \
//     load/customer-browse.js

import http from "k6/http";
import { check, fail, sleep } from "k6";
import encoding from "k6/encoding";
import { Rate } from "k6/metrics";

const TARGET_URL = __ENV.TARGET_URL || "http://localhost:3000";
const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = __ENV.SUPABASE_PUBLISHABLE_KEY;
const TEST_USER_EMAIL = __ENV.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = __ENV.TEST_USER_PASSWORD;

const errorRate = new Rate("errors");

export const options = {
  scenarios: {
    browsing: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 15 },
        { duration: "1m", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1200"], // Supabase-backed reads, looser than the static marketing page
    errors: ["rate<0.02"],
  },
};

function projectRef() {
  if (!SUPABASE_URL) fail("SUPABASE_URL env var is required — see this file's header comment.");
  return new URL(SUPABASE_URL).hostname.split(".")[0];
}

// Runs once per VU, not once per iteration — one login per virtual user,
// matching how a real user actually behaves (log in once, browse many times).
export function setup() {
  if (!SUPABASE_PUBLISHABLE_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
    fail("SUPABASE_PUBLISHABLE_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD env vars are required — see this file's header comment.");
  }

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY } },
  );

  if (res.status !== 200) {
    fail(`Supabase password grant failed (${res.status}): ${res.body} — is TEST_USER_EMAIL a real, confirmed account?`);
  }

  const body = JSON.parse(res.body);
  const session = {
    access_token: body.access_token,
    token_type: body.token_type,
    expires_in: body.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + body.expires_in,
    refresh_token: body.refresh_token,
    user: body.user,
  };

  const cookieValue = "base64-" + encoding.b64encode(JSON.stringify(session));
  const cookieName = `sb-${projectRef()}-auth-token`;

  return { cookieHeader: `${cookieName}=${encodeURIComponent(cookieValue)}` };
}

export default function (data) {
  const headers = { Cookie: data.cookieHeader };

  const home = http.get(`${TARGET_URL}/home`, { headers, tags: { name: "home" } });
  const homeOk = check(home, {
    "verify: session cookie worked (not redirected to /login)": (r) => !r.url.includes("/login"),
    "/home responds 200": (r) => r.status === 200,
  });
  errorRate.add(!homeOk);

  const vendorLinkMatch = home.body.match(/\/vendors\/([a-z0-9-]+)/);
  if (vendorLinkMatch) {
    const vendorPage = http.get(`${TARGET_URL}/vendors/${vendorLinkMatch[1]}`, { headers, tags: { name: "vendor_page" } });
    const vendorOk = check(vendorPage, { "/vendors/[slug] responds 200": (r) => r.status === 200 });
    errorRate.add(!vendorOk);
  }

  sleep(Math.random() * 3 + 2); // 2-5s between page views
}
