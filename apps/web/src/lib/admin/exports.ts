import "server-only";
import type { Json } from "@kiakia/db";
import { requireAdminContext, requireFinanceContext, type Session } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCsvStream, EXPORT_CHUNK_SIZE } from "./csv";
import {
  exportFilename,
  firstIssue,
  ledgerExportSchema,
  ordersExportSchema,
  rangeBounds,
  type LedgerExportParams,
  type OrdersExportParams,
} from "./export-params";
import type { AdminClient } from "./lookups";

/**
 * The two audited CSV exports. The Route Handlers under app/(admin)/admin/*\/export
 * only forward the request here.
 *
 * Order of events, each step failing closed: same-origin check, then the DAL
 * (a Route Handler is reachable by direct POST regardless of which page hosts
 * the form), then validation, then the audit row (admin_log_export, which
 * re-checks the actor in SQL), and only then does the first byte stream.
 *
 * Data minimisation: both exports read only what admin_export_orders_page()
 * (no phone, address, email or delivery code) and admin_export_ledger_page()
 * (no bank details) return.
 */

type Kind = "orders" | "ledger";

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } as const;

function plain(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: TEXT });
}

/**
 * Next.js protects Server Actions by requiring the Origin header's host to equal
 * the Host (or X-Forwarded-Host) header; this applies the same rule to these POST
 * handlers. A missing Origin is accepted only when the browser itself says the
 * request is same-origin (Sec-Fetch-Site), so a cross-site form post is refused
 * and so is a bare scripted request with neither signal.
 */
export function isSameOrigin(request: Request): boolean {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host).split(",")[0]?.trim();
  const origin = request.headers.get("origin");
  if (origin === null) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * redirect() throws an error whose digest is `NEXT_REDIRECT;<push|replace>;<url>;<status>;`
 * (Next 16, client/components/redirect-error.js). isRedirectError is not part of
 * the public API, so the same format is parsed here; the url is everything
 * between the type and the trailing status, since a url may itself contain ";".
 */
function redirectTarget(error: unknown): string | null {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  const parts = digest.split(";");
  if (parts[0] !== "NEXT_REDIRECT" || (parts[1] !== "push" && parts[1] !== "replace")) return null;
  // Next's isRedirectError also requires the status segment to be a redirect status.
  const status = Number(parts.at(-2));
  if (status !== 303 && status !== 307 && status !== 308) return null;
  return parts.slice(2, -2).join(";");
}

type Gate = { readonly session: Session } | { readonly response: Response };

async function authorise(require: () => Promise<Session>): Promise<Gate> {
  try {
    return { session: await require() };
  } catch (error) {
    const target = redirectTarget(error);
    if (target === null) throw error;
    // The DAL sends a signed-out caller to /login and an unauthorised one elsewhere.
    return { response: target === "/login" ? plain(401, "Sign in required.") : plain(403, "Forbidden.") };
  }
}

async function readFields(request: Request, names: readonly string[]): Promise<Record<string, unknown> | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  return Object.fromEntries(names.flatMap((name) => (form.has(name) ? [[name, form.get(name)]] : [])));
}

/** Writes the audit row; its failure modes map onto HTTP so nothing streams without one. */
async function logExport(admin: AdminClient, actorId: string, kind: Kind, filters: Json): Promise<{ exportId: string } | { response: Response }> {
  const { data, error } = await admin.rpc("admin_log_export", { p_actor_id: actorId, p_kind: kind, p_filters: filters });
  if (error || !data) {
    if (error?.code === "42501" || error?.code === "P0001") return { response: plain(403, "Forbidden.") };
    if (error?.code === "23514") return { response: plain(400, "Invalid export request.") };
    console.error("admin_log_export failed", error?.message);
    return { response: plain(500, "Could not record the export; nothing was exported.") };
  }
  return { exportId: data };
}

function csvResponse(body: ReadableStream<Uint8Array>, filename: string, exportId: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Id": exportId,
    },
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ORDERS_HEADER = [
  "order_code",
  "created_at",
  "status",
  "payment_status",
  "vendor_id",
  "vendor_name",
  "customer_id",
  "rider_id",
  "subtotal_kobo",
  "delivery_fee_kobo",
  "service_fee_kobo",
  "discount_kobo",
  "total_kobo",
  "placed_at",
  "delivered_at",
] as const;

interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export function ordersCsvStream(admin: AdminClient, actorId: string, params: OrdersExportParams): ReadableStream<Uint8Array> {
  const { fromIso, toExclusiveIso } = rangeBounds(params);

  return createCsvStream({
    header: ORDERS_HEADER,
    chunkSize: EXPORT_CHUNK_SIZE,
    async fetchPage(after: Cursor | null, limit) {
      // Keyset paging and the vendor-name join both happen in SQL.
      const { data, error } = await admin.rpc("admin_export_orders_page", {
        p_actor_id: actorId,
        p_from: fromIso,
        p_to: toExclusiveIso,
        p_status: params.status ?? null,
        p_vendor_id: params.vendorId ?? null,
        p_after_created_at: after?.createdAt ?? null,
        p_after_id: after?.id ?? null,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    cursorOf: (order) => ({ createdAt: order.created_at, id: order.id }),
    toRows: (orders) =>
      Promise.resolve(
        orders.map((order) => [
          order.code,
          order.created_at,
          order.status,
          order.payment_status,
          order.vendor_id,
          order.vendor_name,
          order.customer_id,
          order.rider_id,
          order.subtotal_kobo,
          order.delivery_fee_kobo,
          order.service_fee_kobo,
          order.discount_kobo,
          order.total_kobo,
          order.placed_at,
          order.delivered_at,
        ]),
      ),
  });
}

export async function handleOrdersExport(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return plain(403, "Cross-origin request refused.");

  const gate = await authorise(() => requireAdminContext());
  if ("response" in gate) return gate.response;

  const fields = await readFields(request, ["from", "to", "status", "vendorId"]);
  if (!fields) return plain(400, "Expected a form submission.");
  const parsed = ordersExportSchema.safeParse(fields);
  if (!parsed.success) return plain(400, firstIssue(parsed.error));
  const params = parsed.data;

  const admin = createAdminClient();
  const logged = await logExport(admin, gate.session.userId, "orders", {
    from: params.from,
    to: params.to,
    ...(params.status ? { status: params.status } : {}),
    ...(params.vendorId ? { vendor_id: params.vendorId } : {}),
  });
  if ("response" in logged) return logged.response;

  return csvResponse(ordersCsvStream(admin, gate.session.userId, params), exportFilename("orders", params), logged.exportId);
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const LEDGER_HEADER = [
  "created_at",
  "transaction_id",
  "transaction_reference",
  "transaction_kind",
  "entry_type",
  "account_owner_type",
  "account_kind",
  "owner_id",
  "direction",
  "amount_kobo",
  "order_code",
] as const;

export function ledgerCsvStream(admin: AdminClient, actorId: string, params: LedgerExportParams): ReadableStream<Uint8Array> {
  const { fromIso, toExclusiveIso } = rangeBounds(params);

  return createCsvStream({
    header: LEDGER_HEADER,
    chunkSize: EXPORT_CHUNK_SIZE,
    async fetchPage(after: Cursor | null, limit) {
      const { data, error } = await admin.rpc("admin_export_ledger_page", {
        p_actor_id: actorId,
        p_from: fromIso,
        p_to: toExclusiveIso,
        p_after_created_at: after?.createdAt ?? null,
        p_after_id: after?.id ?? null,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    cursorOf: (entry) => ({ createdAt: entry.created_at, id: entry.id }),
    toRows: (entries) =>
      Promise.resolve(
        entries.map((entry) => [
          entry.created_at,
          entry.transaction_id,
          entry.transaction_reference,
          entry.transaction_kind,
          entry.entry_type,
          entry.account_owner_type,
          entry.account_kind,
          entry.account_owner_id,
          entry.direction,
          entry.amount_kobo,
          entry.order_code,
        ]),
      ),
  });
}

export async function handleLedgerExport(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return plain(403, "Cross-origin request refused.");

  const gate = await authorise(() => requireFinanceContext());
  if ("response" in gate) return gate.response;

  const fields = await readFields(request, ["from", "to"]);
  if (!fields) return plain(400, "Expected a form submission.");
  const parsed = ledgerExportSchema.safeParse(fields);
  if (!parsed.success) return plain(400, firstIssue(parsed.error));
  const params = parsed.data;

  const admin = createAdminClient();
  const logged = await logExport(admin, gate.session.userId, "ledger", { from: params.from, to: params.to });
  if ("response" in logged) return logged.response;

  return csvResponse(ledgerCsvStream(admin, gate.session.userId, params), exportFilename("ledger", params), logged.exportId);
}
