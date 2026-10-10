// supabase/functions/dispatch-push/expo.ts
//
// The pure, testable pieces: building an Expo push message and reading
// Expo's response into a shape the handler can act on. Kept separate from
// index.ts for the same reason monnify.ts is separate from
// monnify-webhook/index.ts — importing this for a test binds nothing.
//
// No `expo-server-sdk` dependency. The push-send call is one POST with a
// JSON body; the SDK buys batching helpers this function does not need
// (Expo's endpoint already accepts an array in one request) and chunk-size
// bookkeeping that does not matter at fan-out sizes this small (at most 10
// riders per order, `dispatch_order_to_nearby_riders()`'s own hard-coded
// cap, and this function is invoked once per rider, not once per order).

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: string;
  data: Record<string, unknown>;
}

export function buildOfferPushMessages(params: {
  tokens: readonly string[];
  vendorName: string;
  orderId: string;
}): ExpoPushMessage[] {
  return params.tokens.map((to) => ({
    to,
    title: "New delivery",
    body: `Pickup from ${params.vendorName}. Tap to see it.`,
    sound: "default",
    priority: "high",
    // Matches the Android notification channel the app itself creates —
    // `ensureAndroidChannel()`, src/features/notifications/push.ts. A push
    // sent to an unknown channel id on Android arrives silently, without
    // the heads-up banner an offer needs.
    channelId: "offers",
    data: { type: "dispatch_offer", orderId: params.orderId },
  }));
}

/**
 * One "ticket" per message, in the same order the messages were sent.
 * `status: "error"` with `details.error === "DeviceNotRegistered"` is the
 * signal this function's caller uses to prune a dead token — Expo's own
 * documented way of reporting an uninstalled app or a revoked OS permission.
 */
export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function sendExpoPushMessages(
  messages: readonly ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push API returned ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown[] };

  // Expo's top-level `errors` array means the REQUEST itself was malformed
  // (not an individual message) — every ticket would be missing, and
  // there is nothing per-message to report back.
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`Expo push API rejected the request: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data ?? [];
}

/** Token strings from tickets reporting the token as permanently dead. */
export function deadTokensFrom(
  tokens: readonly string[],
  tickets: readonly ExpoPushTicket[],
): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = tokens[index];
      if (token !== undefined) dead.push(token);
    }
  });
  return dead;
}
