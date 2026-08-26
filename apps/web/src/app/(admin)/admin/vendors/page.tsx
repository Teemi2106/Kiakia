// app/(admin)/admin/vendors/page.tsx
import { approveVendorAction, rejectVendorAction } from "@/app/actions/admin";
import { requireAdminContext } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pending vendors" };

/**
 * Pending vendors aren't readable by anything but the vendor's own staff or
 * the platform ("public read active vendors" / "staff read own vendor" —
 * supabase/migrations/0007_rls.sql), and an admin session is neither — so
 * this reads via the admin (service-role) client, same reasoning as the
 * flagged-orders page.
 *
 * requireAdminContext() is called here independently of (admin)/layout.tsx
 * because Next.js 16's partial rendering means a client-side navigation
 * between two admin pages isn't guaranteed to re-run the layout's check —
 * same reasoning that already governs every Server Action in this codebase.
 */
export default async function AdminVendorsPage() {
  await requireAdminContext();

  const admin = createAdminClient();

  const { data: vendors, error } = await admin
    .from("vendors")
    .select("id, name, category, address_line, landmark, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Pending vendors</h1>

      {vendors && vendors.length === 0 && (
        <EmptyState title="No pending vendors" description="Every submitted store has already been reviewed." />
      )}

      {vendors?.map((vendor) => (
        <Card key={vendor.id}>
          <CardHeader>
            <CardTitle>{vendor.name}</CardTitle>
            <span className="text-xs uppercase tracking-wide text-ink-muted">{vendor.category}</span>
          </CardHeader>
          <CardBody>
            <p>{vendor.address_line ?? "No address on file"}</p>
            {vendor.landmark && <p className="text-ink-muted">Near {vendor.landmark}</p>}
            <p className="mt-1 text-xs text-ink-muted">
              Submitted {new Date(vendor.created_at).toLocaleString("en-NG")}
            </p>
          </CardBody>
          <div className="mt-3 flex gap-2">
            <form action={approveVendorAction.bind(null, vendor.id)} className="flex-1">
              <Button type="submit" className="w-full">
                Approve
              </Button>
            </form>
            <form action={rejectVendorAction.bind(null, vendor.id)} className="flex-1">
              <Button type="submit" variant="danger" className="w-full">
                Reject
              </Button>
            </form>
          </div>
        </Card>
      ))}
    </div>
  );
}
