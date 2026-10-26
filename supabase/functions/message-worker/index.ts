// supabase/functions/message-worker/index.ts
//
// Drains message_outbox (migrations 0094-0096, 0103): claims a batch with the SQL
// function message_claim_batch() (FOR UPDATE SKIP LOCKED, queued -> sending,
// attempts + 1, 5-minute lease), sends each row through Resend (email), Termii
// (SMS) or Expo (push: rider dispatch offers, resolved to the rider's
// rider_push_tokens at send time; no token = suppressed 'no_push_token', not a
// failure; DeviceNotRegistered tokens are pruned), and records the outcome with message_mark_sent /
// message_mark_failed / message_mark_suppressed. Retry/backoff/give-up policy
// lives in SQL (message_mark_failed: 30 s, 2 m, 8 m, 32 m, 60 m, 5 attempts).
//
// TRUST BOUNDARY: invoked by pg_cron -> invoke_message_worker() (pg_net) with
// the shared secret in the `x-worker-secret` header (Vault secret
// message_worker_secret == function secret MESSAGE_WORKER_SECRET). verify_jwt is
// false for this function (see supabase/config.toml) because that header is
// the credential; without a matching secret nothing happens. The body is
// ignored: the worker only ever acts on rows it claimed itself.
//
// SECRETS (supabase secrets set ...): MESSAGE_WORKER_SECRET, RESEND_API_KEY,
// MESSAGE_FROM_EMAIL, TERMII_API_KEY, TERMII_SENDER_ID, MESSAGE_UNSUBSCRIBE_SECRET,
// SITE_URL; optional MESSAGE_REPLY_TO, TERMII_BASE_URL, TERMII_TRANSACTIONAL_CHANNEL,
// MESSAGE_UNSUBSCRIBE_ONE_CLICK=false (default on). MESSAGE_PROVIDER_MODE=fake sends nothing over the
// network (provider recorded as "fake").
//
// LOGGING: ids, channels and outcome codes only. Never a body, subject, address
// or key.

import { createClient } from "@supabase/supabase-js";
import { sendOutboxPush } from "../_shared/expo.ts";
import {
  buildEmail,
  buildSms,
  emailUnsubscribeUrl,
  loadConfig,
  type OutboxRow,
  sendEmailViaResend,
  sendSmsViaTermii,
  type SendResult,
  sendViaFake,
  signUnsubscribeToken,
  smsUnsubscribeUrl,
  timingSafeEqual,
} from "../_shared/messaging.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 25;
const CONCURRENCY = 5;
const BUDGET_MS = 45_000;

type Outcome = "sent" | "queued" | "failed" | "suppressed" | "ignored";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const expected = Deno.env.get("MESSAGE_WORKER_SECRET") ?? "";
  if (!expected) {
    console.error("message-worker: MESSAGE_WORKER_SECRET is not set");
    return Response.json({ error: "not configured" }, { status: 500 });
  }
  if (!timingSafeEqual(req.headers.get("x-worker-secret") ?? "", expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const cfg = loadConfig((name) => Deno.env.get(name));
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const started = Date.now();
  const totals: Record<Outcome | "claimed", number> = {
    claimed: 0, sent: 0, queued: 0, failed: 0, suppressed: 0, ignored: 0,
  };

  while (Date.now() - started < BUDGET_MS) {
    const { data, error } = await supabase.rpc("message_claim_batch", { p_limit: BATCH });
    if (error) {
      console.error("message-worker: claim failed", error.code);
      return Response.json({ error: "claim failed", ...totals }, { status: 500 });
    }
    const rows = (data ?? []) as OutboxRow[];
    totals.claimed += rows.length;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(rows.slice(i, i + CONCURRENCY).map((row) => processRow(supabase, cfg, row)));
      for (const o of outcomes) totals[o] += 1;
    }
    if (rows.length < BATCH) break;
  }

  return Response.json({ ok: true, ...totals });
});

// deno-lint-ignore no-explicit-any
async function processRow(supabase: any, cfg: ReturnType<typeof loadConfig>, row: OutboxRow): Promise<Outcome> {
  try {
    // A push has no address: its destinations are the recipient's device tokens, read below.
    if (row.channel !== "push" && !row.to_address) {
      await supabase.rpc("message_mark_suppressed", { p_id: row.id, p_reason: "no_address" });
      return "suppressed";
    }

    let result: SendResult;
    let provider: string;
    if (cfg.mode === "fake") {
      provider = "fake";
      result = sendViaFake(row);
    } else if (row.channel === "push") {
      provider = "expo";
      return await processPush(supabase, row);
    } else if (row.channel === "email") {
      provider = "resend";
      let unsubscribeUrl: string | undefined;
      if (row.category === "promotional") {
        if (!row.recipient_user_id || !cfg.siteUrl || !cfg.unsubscribeSecret) {
          // Never send a promotional message without a working opt-out path.
          result = { ok: false, permanent: false, error: "provider_not_configured: unsubscribe" };
          return await record(supabase, row, provider, result);
        }
        const token = await signUnsubscribeToken(row.recipient_user_id, "email", cfg.unsubscribeSecret);
        unsubscribeUrl = emailUnsubscribeUrl(cfg.siteUrl, token);
      }
      const email = buildEmail({ subject: row.subject ?? "", body: row.body, unsubscribeUrl });
      result = await sendEmailViaResend(cfg, row, email, unsubscribeUrl);
    } else {
      provider = "termii";
      let optOutUrl: string | undefined;
      if (row.category === "promotional") {
        if (!row.recipient_user_id || !cfg.siteUrl || !cfg.unsubscribeSecret) {
          result = { ok: false, permanent: false, error: "provider_not_configured: unsubscribe" };
          return await record(supabase, row, provider, result);
        }
        const token = await signUnsubscribeToken(row.recipient_user_id, "sms", cfg.unsubscribeSecret);
        optOutUrl = smsUnsubscribeUrl(cfg.siteUrl, token);
      }
      result = await sendSmsViaTermii(cfg, row, buildSms(row.body, optOutUrl));
    }
    return await record(supabase, row, provider, result);
  } catch (error) {
    // Unexpected: treat as transient. The error text may not carry content.
    console.error("message-worker: unexpected error", row.id, error instanceof Error ? error.name : "unknown");
    await supabase.rpc("message_mark_failed", { p_id: row.id, p_error: "worker_exception", p_permanent: false });
    return "queued";
  }
}

// deno-lint-ignore no-explicit-any
async function processPush(supabase: any, row: OutboxRow): Promise<Outcome> {
  let tokens: string[] = [];
  if (row.recipient_user_id) {
    const { data, error } = await supabase.from("rider_push_tokens").select("token").eq("rider_id", row.recipient_user_id);
    if (error) {
      // Cannot tell "no tokens" from "could not look": retry rather than drop the push.
      return await record(supabase, row, "expo", { ok: false, permanent: false, error: "token_lookup_failed" });
    }
    tokens = ((data ?? []) as { token: string }[]).map((r) => r.token);
  }

  const outcome = await sendOutboxPush(row, tokens);

  if (outcome.dead.length > 0 && row.recipient_user_id) {
    // Housekeeping: Expo says these devices are gone (uninstall / revoked permission).
    const { error } = await supabase.from("rider_push_tokens").delete().eq("rider_id", row.recipient_user_id).in("token", outcome.dead);
    if (error) console.error("message-worker: token prune failed", row.id, error.code);
  }

  if (outcome.kind === "no_tokens") {
    await supabase.rpc("message_mark_suppressed", { p_id: row.id, p_reason: "no_push_token" });
    console.log(JSON.stringify({ id: row.id, channel: "push", outcome: "suppressed", reason: "no_push_token", pruned: outcome.dead.length }));
    return "suppressed";
  }
  if (outcome.kind === "sent") {
    return await record(supabase, row, "expo", { ok: true, providerMessageId: outcome.providerMessageId });
  }
  return await record(supabase, row, "expo", { ok: false, permanent: outcome.permanent, error: outcome.error });
}

// deno-lint-ignore no-explicit-any
async function record(supabase: any, row: OutboxRow, provider: string, result: SendResult): Promise<Outcome> {
  if (result.ok) {
    const { error } = await supabase.rpc("message_mark_sent", {
      p_id: row.id,
      p_provider: provider,
      p_provider_message_id: result.providerMessageId,
    });
    if (error) {
      // The provider accepted it but we could not record that. The lease will
      // expire and the row is re-claimed; Resend's Idempotency-Key makes the
      // resend a no-op, SMS could duplicate (bounded by max attempts).
      console.error("message-worker: mark_sent failed", row.id, error.code);
    }
    console.log(JSON.stringify({ id: row.id, channel: row.channel, outcome: "sent", provider }));
    return "sent";
  }
  const { data, error } = await supabase.rpc("message_mark_failed", {
    p_id: row.id,
    p_error: result.error,
    p_permanent: result.permanent,
  });
  if (error) console.error("message-worker: mark_failed failed", row.id, error.code);
  console.log(JSON.stringify({ id: row.id, channel: row.channel, outcome: data ?? "unknown", error: result.error }));
  return data === "failed" ? "failed" : data === "suppressed" ? "suppressed" : data === "ignored" ? "ignored" : "queued";
}
