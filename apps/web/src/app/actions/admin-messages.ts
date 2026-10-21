"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSuperadmin, requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { field, rpcFailureMessage, type FormState } from "@/lib/admin/action-helpers";
import { listUsers } from "@/lib/admin/users";
import { previewAudience, type AudiencePreview } from "@/lib/admin/messages";
import { audienceSchema, broadcastSchema, directMessageSchema, firstIssue } from "@/lib/validation/admin";

/** Tells an admin, in words, why only a superadmin can send promotions. Never a dead end. */
const PROMOTION_NEEDS_SUPERADMIN =
  "Only a superadmin can send promotions. Ask a superadmin to send this, or send it as a service message if it is about someone's order or account.";

export interface SendState extends FormState {
  /** The message that was created, so the form can link to its history. */
  readonly broadcastId?: string;
}

/**
 * Turns the messaging RPCs' refusals (written for developers) into plain words.
 * Anything not recognised goes through the shared mapping, which never shows raw
 * database text for unexpected errors.
 */
function sendFailureMessage(error: { message: string; code?: string }): string {
  const text = error.message;
  if (/account is suspended/.test(text)) return "This account is suspended, so no message was sent.";
  const noAddress = /has no (verified email address|phone number) on file/.exec(text);
  if (noAddress) {
    return noAddress[1] === "phone number"
      ? "This person has no phone number on file, so we cannot text them. Try email instead."
      : "This person has no confirmed email address on file, so we cannot email them. Try a text message instead.";
  }
  if (/no deliverable recipients/.test(text)) {
    return "Nobody in this group can get this message. Everyone is skipped: no email or phone number on file, they have not agreed to promotions, or their account is suspended.";
  }
  const cap = /exceeds the cap of (\d+)/.exec(text);
  if (cap) return `That would reach more than ${cap[1]} people at once. Choose a smaller group, for example only active vendors.`;
  if (/rate limit reached/.test(text)) {
    return text.startsWith("admin_send_message")
      ? "You have sent a lot of messages in the last hour. Please wait a while and try again."
      : "Too many messages of this kind have already gone out in the last 24 hours. Please try again tomorrow, or ask a superadmin.";
  }
  if (/empty once variables are removed/.test(text)) return "The message is empty once names are filled in. Add some text of your own.";
  return rpcFailureMessage(error);
}

const submissionKey = z.string().max(100).optional();

function parseAudience(raw: string | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends one message to a group. Service messages: any admin. Promotions:
 * superadmin only (admin_create_broadcast enforces the same; this check only
 * gives a clear answer first). The RPC counts who is eligible, writes the audit
 * entry and queues the messages; the sending itself happens afterwards.
 */
export async function sendBroadcastAction(_prevState: SendState, formData: FormData): Promise<SendState> {
  const session = await requireAdminContext();

  const parsed = broadcastSchema.safeParse({
    audience: parseAudience(field(formData, "audience")),
    channel: field(formData, "channel"),
    category: field(formData, "category"),
    subject: field(formData, "subject"),
    body: field(formData, "body"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  if (parsed.data.category === "promotional" && !(await isSuperadmin())) {
    return { error: PROMOTION_NEEDS_SUPERADMIN };
  }

  // One id per form load: the database returns the same broadcast for a repeated id, so a double click or a retry cannot send twice.
  const idempotencyKey = submissionKey.safeParse(field(formData, "submissionId")).data?.slice(0, 100) || null;

  const { data, error } = await createAdminClient().rpc("admin_create_broadcast", {
    p_actor_id: session.userId,
    p_audience: parsed.data.audience,
    p_channel: parsed.data.channel,
    p_category: parsed.data.category,
    p_subject: parsed.data.channel === "sms" ? null : (parsed.data.subject ?? null),
    p_body: parsed.data.body,
    p_reason: parsed.data.reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return { error: sendFailureMessage(error) };

  const broadcastId = typeof data === "string" ? data : undefined;
  revalidatePath("/admin/messages");
  return {
    success: true,
    broadcastId,
    message: "Your message is on its way. People are being sent it now. Open the message history to watch it go out.",
  };
}

/** One-to-one service message to a single person from their account page. Any admin; never promotional. */
export async function sendMessageAction(_prevState: SendState, formData: FormData): Promise<SendState> {
  const session = await requireAdminContext();

  const parsed = directMessageSchema.safeParse({
    userId: field(formData, "userId"),
    channel: field(formData, "channel"),
    subject: field(formData, "subject"),
    body: field(formData, "body"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // No key needed: admin_send_message returns the original when the same admin repeats the same message to the same person within 2 minutes.
  const { error } = await createAdminClient().rpc("admin_send_message", {
    p_actor_id: session.userId,
    p_user_id: parsed.data.userId,
    p_channel: parsed.data.channel,
    p_subject: parsed.data.channel === "sms" ? null : (parsed.data.subject ?? null),
    p_body: parsed.data.body,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: sendFailureMessage(error) };

  revalidatePath("/admin/messages");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  revalidatePath(`/admin/customers/${parsed.data.userId}`);
  return { success: true, message: "Message queued. It will show under Recent messages in a moment." };
}

export interface PreviewResult {
  readonly preview?: AudiencePreview;
  readonly error?: string;
}

const previewInput = z.object({
  audience: audienceSchema,
  channel: z.enum(["email", "sms"]),
  category: z.enum(["transactional", "promotional"]),
});

/** "Who will get this" for the compose form. Read-only, any admin. */
export async function previewAudienceAction(input: unknown): Promise<PreviewResult> {
  await requireAdminContext();
  const parsed = previewInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    return { preview: await previewAudience(parsed.data.audience, parsed.data.channel, parsed.data.category) };
  } catch (error) {
    console.error("audience preview failed", error instanceof Error ? error.message : "unknown");
    return { error: "We could not work out who would get this. Please try again." };
  }
}

export interface PersonHit {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
}

/** Name or phone search for the "one specific person" picker. Reuses the accounts search. */
export async function searchPeopleAction(query: string): Promise<PersonHit[]> {
  await requireAdminContext();
  const q = typeof query === "string" ? query.trim().slice(0, 64) : "";
  if (q.length < 2) return [];
  const result = await listUsers({ q, status: "active", page: 1, pageSize: 8 });
  return result.rows.map((row) => ({ id: row.id, name: row.fullName ?? "Unnamed account", phone: row.phone }));
}
