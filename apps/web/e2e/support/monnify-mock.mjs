/* eslint-disable no-console -- a CLI script: stdout is its interface */
// A tiny stand-in for Monnify's REST API, used ONLY by the full-cycle e2e run
// (see e2e/README.md). Both the Next.js server (lib/monnify.ts: login +
// init-transaction) and the monnify-webhook Edge Function
// (supabase/functions/monnify-webhook/monnify.ts: login + GET transaction)
// point MONNIFY_BASE_URL at this process, so the REAL application code paths
// run; only the third party is faked.
//
//   POST /api/v1/auth/login                         -> a bearer token
//   POST /api/v1/merchant/transactions/init-transaction
//        records {paymentReference, amount(naira)}; returns checkoutUrl +
//        transactionReference. The transaction starts as PENDING.
//   GET  /api/v2/transactions/:transactionReference -> what the webhook
//        function re-verifies. Whatever the test last set (default: PENDING).
//   POST /__control/transactions   {paymentReference, paymentStatus?, amountPaidNaira?, paymentMethod?}
//        the test's "customer paid at the bank" lever. Unknown payment
//        references are created on the fly so a test can also simulate a
//        transaction the app never initialised.
//   GET  /__control/transactions   dumps state (debugging)
//   POST /api/v1/refunds/initiate-refund  -> records the refund request (gateway-refund path)
//   GET  /__control/refunds
//   GET  /checkout/:ref            a stub "hosted checkout" page the customer is redirected to
//
// Never talks to the internet. Listens on 0.0.0.0 so the Supabase Edge
// Runtime container can reach it via host.docker.internal.

import http from "node:http";

const port = Number(process.env.MONNIFY_MOCK_PORT ?? 59080);

/** @type {Map<string, any>} keyed by transactionReference */
const transactions = new Map();
/** @type {Map<string, string>} paymentReference -> transactionReference */
const byPaymentRef = new Map();
const refunds = [];
let seq = 0;

function envelope(body, ok = true) {
  return JSON.stringify({
    requestSuccessful: ok,
    responseMessage: ok ? "success" : "failed",
    responseCode: ok ? "0" : "99",
    responseBody: body,
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

// Unique per mock-process start: payments.provider_ref is unique and the stack's database outlives
// the mock, so a counter alone would collide on the second run against a reused stack.
const RUN_TAG = Date.now().toString(36).toUpperCase();

function ensureTransaction(paymentReference, init = {}) {
  let ref = byPaymentRef.get(paymentReference);
  if (!ref) {
    ref = `MNFY|MOCK|${RUN_TAG}|${String(++seq).padStart(6, "0")}`;
    byPaymentRef.set(paymentReference, ref);
    transactions.set(ref, {
      transactionReference: ref,
      paymentReference,
      amountPaid: 0,
      amountExpected: init.amountExpected ?? 0,
      paymentStatus: "PENDING",
      paidOn: null,
      currency: "NGN",
      paymentMethod: null,
    });
  }
  return transactions.get(ref);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");

    if (req.method === "POST" && url.pathname === "/api/v1/auth/login") {
      return send(res, 200, envelope({ accessToken: "mock-token", expiresIn: 3600 }));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/merchant/transactions/init-transaction") {
      const body = await readJson(req);
      const tx = ensureTransaction(body.paymentReference, { amountExpected: body.amount });
      tx.amountExpected = body.amount;
      const origin = `http://localhost:${port}`;
      return send(
        res,
        200,
        envelope({
          transactionReference: tx.transactionReference,
          paymentReference: tx.paymentReference,
          checkoutUrl: `${origin}/checkout/${encodeURIComponent(tx.transactionReference)}`,
        }),
      );
    }

    const txMatch = url.pathname.match(/^\/api\/v2\/transactions\/(.+)$/);
    if (req.method === "GET" && txMatch) {
      const tx = transactions.get(decodeURIComponent(txMatch[1]));
      if (!tx) return send(res, 404, envelope(null, false));
      return send(res, 200, envelope(tx));
    }

    if (req.method === "POST" && url.pathname === "/__control/transactions") {
      const body = await readJson(req);
      const tx = ensureTransaction(body.paymentReference);
      if (body.paymentStatus) tx.paymentStatus = body.paymentStatus;
      if (body.amountPaidNaira !== undefined) tx.amountPaid = body.amountPaidNaira;
      if (body.paymentMethod !== undefined) tx.paymentMethod = body.paymentMethod;
      if (tx.paymentStatus === "PAID" || tx.paymentStatus === "OVERPAID") tx.paidOn = new Date().toISOString();
      return send(res, 200, JSON.stringify(tx));
    }

    if (req.method === "GET" && url.pathname === "/__control/transactions") {
      return send(res, 200, JSON.stringify([...transactions.values()]));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/refunds/initiate-refund") {
      const body = await readJson(req);
      refunds.push(body);
      return send(
        res,
        200,
        envelope({ refundReference: body.refundReference ?? "mock-refund", refundStatus: "IN_PROGRESS", refundAmount: body.refundAmount }),
      );
    }

    if (req.method === "GET" && url.pathname === "/__control/refunds") {
      return send(res, 200, JSON.stringify(refunds));
    }

    if (req.method === "GET" && url.pathname.startsWith("/checkout/")) {
      return send(
        res,
        200,
        `<!doctype html><title>Mock Monnify checkout</title><h1>Mock Monnify hosted checkout</h1><p>${decodeURIComponent(
          url.pathname.slice("/checkout/".length),
        )}</p>`,
        "text/html",
      );
    }

    send(res, 404, envelope(null, false));
  } catch (error) {
    send(res, 500, JSON.stringify({ error: String(error) }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[monnify-mock] listening on :${port}`);
});
