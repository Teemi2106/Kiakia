import { ORDER_STATUSES } from "@kiakia/domain";
import { z } from "zod";

/**
 * Validation for the export forms. Pure (no server-only import) so it is unit
 * tested directly. Unlike the list pages, which quietly drop a filter they
 * cannot parse, an export refuses it: a silently unfiltered file would be
 * mistaken for the filtered one the admin asked for.
 */

export const MAX_EXPORT_DAYS = 92;
const DAY_MS = 86_400_000;

function parseDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March; the round trip catches that.
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

/** A blank form field means "not provided". */
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const dateFields = {
  from: z.string({ required_error: "from is required (YYYY-MM-DD)", invalid_type_error: "from must be a date" }).trim(),
  to: z.string({ required_error: "to is required (YYYY-MM-DD)", invalid_type_error: "to must be a date" }).trim(),
};

function checkRange(range: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  if (from === null || to === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from and to must be real dates in YYYY-MM-DD format" });
  } else if (to < from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "to must not be before from" });
  } else if ((to - from) / DAY_MS + 1 > MAX_EXPORT_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `the date range is limited to ${MAX_EXPORT_DAYS} days` });
  }
}

export const ordersExportSchema = z
  .object({
    ...dateFields,
    status: z.preprocess(blankToUndefined, z.enum(ORDER_STATUSES, { errorMap: () => ({ message: "unknown order status" }) }).optional()),
    vendorId: z.preprocess(blankToUndefined, z.string().uuid("vendorId must be a uuid").optional()),
  })
  .superRefine(checkRange);
export const ledgerExportSchema = z.object(dateFields).superRefine(checkRange);

export type OrdersExportParams = z.infer<typeof ordersExportSchema>;
export type LedgerExportParams = z.infer<typeof ledgerExportSchema>;

/** [from 00:00 UTC, day after `to` 00:00 UTC): the same inclusive-day, UTC semantics as the orders list filter. */
export function rangeBounds(range: { readonly from: string; readonly to: string }): { fromIso: string; toExclusiveIso: string } {
  return {
    fromIso: `${range.from}T00:00:00.000Z`,
    toExclusiveIso: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS).toISOString(),
  };
}

export function exportFilename(kind: "orders" | "ledger", range: { readonly from: string; readonly to: string }): string {
  return `kiakia-${kind}-${range.from}_${range.to}.csv`;
}

/** First problem as a plain sentence for a 400 body. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid request";
}
