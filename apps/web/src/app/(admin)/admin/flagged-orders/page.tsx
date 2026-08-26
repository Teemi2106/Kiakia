// app/(admin)/admin/flagged-orders/page.tsx
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Flagged orders" };

/**
 * "Flagged" = an order_events row written by capture_payment()
 * (supabase/migrations/0017_fix_capture_payment_amount_mismatch.sql) with
 * `meta->>'amount_mismatch' = 'true'` (paid amount != order total) or
 * `meta->>'duplicate_capture_attempt' = 'true'` (a second payment captured
 * against an already-paid order). Neither is readable via the user-scoped
 * client for an admin session (RLS's "read events of visible
 * orders" policy — 0007_rls.sql — only covers the order's own
 * customer/rider/vendor staff, none of which an admin is), so this reads via
 * the admin (service-role) client. Read-only: no escrow-release/refund
 * tooling exists yet to act on these (out of scope for this round).
 *
 * requireAdminContext() is called here independently of (admin)/layout.tsx
 * for the same reason as the vendors page — partial rendering means a
 * client-side nav between admin pages doesn't guarantee the layout re-runs.
 */
export default async function FlaggedOrdersPage() {
  await requireAdminContext();

  const admin = createAdminClient();

  const { data: events, error } = await admin
    .from("order_events")
    .select("id, order_id, actor_type, at, meta")
    .or("meta->>amount_mismatch.eq.true,meta->>duplicate_capture_attempt.eq.true")
    .order("at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  const orderIds = Array.from(new Set((events ?? []).map((event) => event.order_id)));

  const { data: orders } = orderIds.length
    ? await admin.from("orders").select("id, code, total_kobo, customer_id").in("id", orderIds)
    : { data: [] as { id: string; code: string; total_kobo: number; customer_id: string }[] };

  const ordersById = new Map((orders ?? []).map((order) => [order.id, order]));

  const customerIds = Array.from(new Set((orders ?? []).map((order) => order.customer_id)));
  const { data: profiles } = customerIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", customerIds)
    : { data: [] as { id: string; full_name: string | null }[] };

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Flagged orders</h1>
      <p className="text-sm text-ink-muted">
        Payment-capture anomalies recorded by capture_payment() — an amount that didn&apos;t match the order
        total, or a second payment captured against an order that was already paid. Read-only.
      </p>

      {events && events.length === 0 && (
        <EmptyState title="No flagged orders" description="No amount mismatches or duplicate captures recorded." />
      )}

      {events?.map((event) => {
        const order = ordersById.get(event.order_id);
        const customer = order ? profilesById.get(order.customer_id) : undefined;
        const meta = (event.meta ?? {}) as Record<string, unknown>;
        const isAmountMismatch = meta.amount_mismatch === true || meta.amount_mismatch === "true";
        const isDuplicateCapture =
          meta.duplicate_capture_attempt === true || meta.duplicate_capture_attempt === "true";

        return (
          <Card key={event.id}>
            <CardHeader>
              <CardTitle>{order ? `Order ${order.code}` : `Order ${event.order_id}`}</CardTitle>
              <div className="flex gap-2">
                {isAmountMismatch && <Badge tone="danger">Amount mismatch</Badge>}
                {isDuplicateCapture && <Badge tone="warning">Duplicate capture</Badge>}
              </div>
            </CardHeader>
            <CardBody>
              <p>
                Customer: {customer?.full_name ?? "Unknown"}
                {order && <> · Order total {formatNaira(koboOf(order.total_kobo))}</>}
              </p>
              <p className="mt-1 text-xs text-ink-muted">{new Date(event.at).toLocaleString("en-NG")}</p>

              {isAmountMismatch && (
                <div className="mt-3 flex flex-col gap-1 rounded-control bg-danger-surface p-3 text-danger">
                  <span>
                    Paid: {formatNaira(koboOf(Number(meta.paid_amount_kobo ?? 0)))} vs expected:{" "}
                    {formatNaira(koboOf(Number(meta.expected_total_kobo ?? 0)))}
                  </span>
                </div>
              )}

              {isDuplicateCapture && (
                <div className="mt-3 flex flex-col gap-1 rounded-control bg-warning-surface p-3 text-warning">
                  <span>Existing provider ref: {String(meta.existing_provider_ref ?? "—")}</span>
                  <span>New provider ref: {String(meta.new_provider_ref ?? "—")}</span>
                  <span>
                    New amount: {formatNaira(koboOf(Number(meta.new_amount_kobo ?? 0)))}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
