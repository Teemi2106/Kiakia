import { nairaToKobo } from "@kiakia/domain";
import { z } from "zod";
import {
  DISPATCH_SETTING_KEYS,
  dispatchRangeError,
  parseDispatchInput,
} from "@/lib/admin/dispatch-settings-info";
import { isValidSegment } from "@/lib/messaging/audience";
import { EMAIL_BODY_MAX_CHARS, needsWideEncoding, smsMaxChars, SUBJECT_MAX_CHARS, WORST_CASE_FIRST_NAME, WORST_CASE_STORE_NAME } from "@/lib/messaging/limits";
import { renderTemplate, unknownPlaceholders } from "@/lib/messaging/templates";

function worstCaseRender(text: string): string {
  return renderTemplate(text, { first_name: WORST_CASE_FIRST_NAME, store_name: WORST_CASE_STORE_NAME });
}

/**
 * Input schemas for the admin Server Actions. Every id is a uuid and every
 * amount is validated here before it can reach an RPC; the RPCs re-validate
 * (the database is the real boundary), so these exist to return a clear form
 * error rather than a Postgres one.
 */

export const uuidSchema = z.string().uuid("Invalid id");

/** A reason the admin must give — recorded verbatim in the audit log. */
const requiredReason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(1000, "Keep the reason under 1000 characters");

/** A reason the admin may leave blank; blank becomes undefined. */
const optionalReason = z
  .string()
  .trim()
  .max(1000, "Keep the reason under 1000 characters")
  .transform((value) => value || undefined)
  .optional();

/**
 * For routine actions: the admin may skip the reason, and the audit log gets a
 * plain description instead (the RPCs still require a non-empty reason).
 */
const reasonOrDefault = (fallback: string) =>
  z
    .string()
    .trim()
    .max(1000, "Keep the reason under 1000 characters")
    .optional()
    .transform((value) => value || fallback);

/**
 * Naira as typed by an admin ("1234", "1,234.50") to whole kobo. Strict: at
 * most two decimals, no signs or exponents, so float parsing can never round
 * a typed amount to a different kobo value.
 */
function nairaToKoboSchema(minKobo: number, label: string) {
  return z
    .string()
    .trim()
    .transform((value) => value.replace(/,/g, ""))
    .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, `${label} must be a naira amount with at most 2 decimals`))
    .transform((value) => nairaToKobo(Number(value)))
    .pipe(z.number().min(minKobo, minKobo > 0 ? `${label} must be greater than zero` : `${label} cannot be negative`));
}

const positiveNairaSchema = (label: string) => nairaToKoboSchema(1, label);

/** Mirrors the cap in admin_update_service_area(): NGN 100,000 per fee field. */
const MAX_FEE_KOBO = 10_000_000;
const feeNairaSchema = (label: string) =>
  nairaToKoboSchema(0, label).pipe(z.number().max(MAX_FEE_KOBO, `${label} cannot exceed NGN 100,000`));

/** "12.5" percent to whole basis points (1250). */
const commissionPercentSchema = z
  .string()
  .trim()
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage with at most 2 decimals"))
  .transform((value) => Math.round(Number(value) * 100))
  .pipe(z.number().int().min(0).max(10_000, "Commission cannot exceed 100%"));

export const setUserStatusSchema = z
  .object({
    userId: uuidSchema,
    status: z.enum(["active", "suspended"]),
    reason: optionalReason,
  })
  .refine((value) => value.status === "active" || value.reason, {
    message: "Give a reason for suspending an account",
    path: ["reason"],
  });

export const setPlatformRoleSchema = z.object({
  userId: uuidSchema,
  role: z.enum(["admin", "superadmin", "rider"]),
  action: z.enum(["grant", "revoke"]),
  reason: requiredReason,
});

export const setVendorCommissionSchema = z.object({
  vendorId: uuidSchema,
  commissionBps: commissionPercentSchema,
  reason: requiredReason,
});

/**
 * Platform-wide fees stored in platform_settings (0092). Entered as a
 * percentage, stored as basis points. The ceilings mirror
 * admin_set_platform_fee(): service fee 20%, default commission 50%.
 */
export const PLATFORM_FEE_KEYS = ["service_fee_bps", "default_vendor_commission_bps"] as const;
export type PlatformFeeKey = (typeof PLATFORM_FEE_KEYS)[number];

export const PLATFORM_FEE_MAX_BPS: Record<PlatformFeeKey, number> = {
  service_fee_bps: 2000,
  default_vendor_commission_bps: 5000,
};

const PLATFORM_FEE_NAMES: Record<PlatformFeeKey, string> = {
  service_fee_bps: "The service fee",
  default_vendor_commission_bps: "The default commission",
};

export const setPlatformFeeSchema = z
  .object({
    key: z.enum(PLATFORM_FEE_KEYS, { message: "Unknown fee" }),
    valueBps: commissionPercentSchema,
    reason: requiredReason,
  })
  .superRefine((value, ctx) => {
    const max = PLATFORM_FEE_MAX_BPS[value.key];
    if (value.valueBps > max) {
      ctx.addIssue({ code: "custom", path: ["valueBps"], message: `${PLATFORM_FEE_NAMES[value.key]} cannot exceed ${max / 100}%` });
    }
  });

/**
 * A rider-matching setting. `input` is what the admin typed (km, a count, or
 * minutes, per the setting) and is converted to the stored unit here.
 * The RPC re-checks the range and writes the audit row.
 */
export const setDispatchSettingSchema = z
  .object({
    key: z.enum(DISPATCH_SETTING_KEYS, { message: "Unknown setting" }),
    input: z.string().trim().min(1, "Enter a value"),
    reason: reasonOrDefault("Rider matching setting changed"),
  })
  .transform((value, ctx) => {
    const parsed = parseDispatchInput(value.key, value.input);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", path: ["input"], message: "Enter a plain number, for example 5 or 7.5." });
      return z.NEVER;
    }
    const rangeError = dispatchRangeError(value.key, parsed);
    if (rangeError) {
      ctx.addIssue({ code: "custom", path: ["input"], message: rangeError });
      return z.NEVER;
    }
    return { key: value.key, value: parsed, reason: value.reason };
  });

export const redispatchOrderSchema = z.object({ orderId: uuidSchema });

export const updateServiceAreaSchema = z.object({
  serviceAreaId: uuidSchema,
  baseDeliveryFeeKobo: feeNairaSchema("Base delivery fee"),
  perKmFeeKobo: feeNairaSchema("Delivery fee per km"),
  riderBaseFeeKobo: feeNairaSchema("Rider base fee"),
  riderPerKmFeeKobo: feeNairaSchema("Rider fee per km"),
  // Explicit "true"/"false" (a select or radio) rather than a checkbox: an absent
  // checkbox would silently deactivate the area.
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: reasonOrDefault("Service area updated"),
});

export const recordPayoutSchema = z.object({
  ownerType: z.enum(["vendor", "rider"]),
  ownerId: uuidSchema,
  amountKobo: positiveNairaSchema("Amount"),
  externalReference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,64}$/, "Use the bank's reference: 3-64 letters, digits, dots, dashes or underscores"),
  reason: optionalReason,
});

export const refundOrderSchema = z.object({
  orderId: uuidSchema,
  reason: requiredReason,
  destination: z.enum(["wallet", "gateway"]),
});

export const gatewayRefundSchema = z.object({
  orderId: uuidSchema,
  reason: optionalReason,
});

/** A blank rider means "unassign and re-offer"; a rider id forces that rider onto the order. */
export const reassignOrderRiderSchema = z.object({
  orderId: uuidSchema,
  riderId: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .pipe(uuidSchema.optional())
    .optional(),
  reason: reasonOrDefault("Rider changed on this order by an admin"),
});

export const rejectDocumentSchema = z.object({
  documentId: uuidSchema,
  note: requiredReason,
});

/** Optional free-text reason carried by the one-click approve/reject buttons. */
export const optionalReasonSchema = optionalReason;

/**
 * Admin messages (broadcasts and one-to-one). The length limits mirror
 * admin_create_broadcast / admin_send_message; see lib/messaging/limits.ts.
 */
export const audienceSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("role"), role: z.enum(["customer", "vendor", "rider"]), segment: z.string().min(1) }),
    z.object({ kind: z.literal("user"), user_id: uuidSchema }),
  ])
  .refine((audience) => audience.kind === "user" || isValidSegment(audience.role, audience.segment), {
    message: "Pick a valid group of people to send to",
  });

const channelSchema = z.enum(["email", "sms"], { message: "Choose email or text message" });

function checkMessageContent(
  value: { channel: "email" | "sms"; category: "transactional" | "promotional"; subject?: string; body: string; audience?: z.infer<typeof audienceSchema> },
  ctx: z.RefinementCtx,
) {
  const issue = (path: "subject" | "body", message: string) => ctx.addIssue({ code: "custom", path: [path], message });

  if (value.channel === "email" && !value.subject) issue("subject", "Add a subject for the email");
  if (/[\x01-\x1f\x7f]/.test(value.subject ?? "")) issue("subject", "The subject must be a single line");
  if (/[\x01-\x08\x0b-\x1f\x7f]/.test(value.body)) issue("body", "The message has characters that cannot be sent. Remove them or retype that part.");

  const unknown = [...unknownPlaceholders(value.body), ...unknownPlaceholders(value.subject ?? "")];
  if (unknown.length > 0) {
    issue("body", `${unknown[0]} is not something we can fill in. Use only {{first_name}} or {{store_name}}.`);
  }
  const storeName = [value.body, value.subject ?? ""].some((text) => /\{\{\s*store_name\s*\}\}/i.test(text));
  if (storeName && value.audience && !(value.audience.kind === "role" && value.audience.role === "vendor")) {
    issue("body", "{{store_name}} only works when you are writing to vendors");
  }

  // The database checks the longest the text could become, with a 40-character first name and a 60-character store name.
  const worst = worstCaseRender(value.body);
  if (value.channel === "sms") {
    const limit = smsMaxChars(worst, value.category === "promotional");
    if (worst.length > limit) {
      issue(
        "body",
        needsWideEncoding(worst)
          ? `This text has special characters or emoji, so it can be at most ${limit} characters once names are filled in. Shorten it or remove them.`
          : `A text message can be at most ${limit} characters once names are filled in`,
      );
    }
  } else {
    if (worstCaseRender(value.subject ?? "").length > SUBJECT_MAX_CHARS) issue("subject", `Keep the subject under ${SUBJECT_MAX_CHARS} characters`);
    if (worst.length > EMAIL_BODY_MAX_CHARS) issue("body", `An email can be at most ${EMAIL_BODY_MAX_CHARS} characters`);
  }
}

const subjectSchema = z
  .string()
  .trim()
  .max(1000, "That subject is too long")
  .transform((value) => value || undefined)
  .optional();

/** Browsers send line breaks as CRLF; the database stores a plain line feed. */
const bodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().min(1, "Write the message").max(EMAIL_BODY_MAX_CHARS * 2, "That message is too long"));

export const broadcastSchema = z
  .object({
    audience: audienceSchema,
    channel: channelSchema,
    category: z.enum(["transactional", "promotional"]),
    subject: subjectSchema,
    body: bodySchema,
    reason: reasonOrDefault("Message sent from the admin messages page"),
  })
  .superRefine(checkMessageContent);

export const directMessageSchema = z
  .object({
    userId: uuidSchema,
    channel: channelSchema,
    subject: subjectSchema,
    body: bodySchema,
    reason: reasonOrDefault("Message sent from the admin messages page"),
  })
  .superRefine((value, ctx) => checkMessageContent({ ...value, category: "transactional", audience: { kind: "user", user_id: value.userId } }, ctx));

/** First zod issue as a single form-level message. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
