import { nairaToKobo } from "@kiakia/domain";
import { z } from "zod";

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

export const updateServiceAreaSchema = z.object({
  serviceAreaId: uuidSchema,
  baseDeliveryFeeKobo: feeNairaSchema("Base delivery fee"),
  perKmFeeKobo: feeNairaSchema("Delivery fee per km"),
  riderBaseFeeKobo: feeNairaSchema("Rider base fee"),
  riderPerKmFeeKobo: feeNairaSchema("Rider fee per km"),
  // Explicit "true"/"false" (a select or radio) rather than a checkbox: an absent
  // checkbox would silently deactivate the area.
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: requiredReason,
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
  reason: requiredReason,
});

export const rejectDocumentSchema = z.object({
  documentId: uuidSchema,
  note: requiredReason,
});

/** Optional free-text reason carried by the one-click approve/reject buttons. */
export const optionalReasonSchema = optionalReason;

/** First zod issue as a single form-level message. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
