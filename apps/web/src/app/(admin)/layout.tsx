// app/(admin)/layout.tsx
import { requireAdminContext } from "@/lib/auth/dal";
import Link from "next/link";

/**
 * Gates the (admin) route group — mirrors (vendor)/layout.tsx's structure,
 * simpler: this is an internal tool for admin/superadmin staff, not a
 * customer/vendor-facing surface, so no active-mode cookie, no bottom nav,
 * no sidebar bells and whistles. requireAdminContext() is the real gate;
 * proxy.ts only proved "logged in".
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminContext("/home");

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken">
      <header className="border-b border-border bg-surface-raised px-6 py-4">
        <nav className="flex items-center gap-6 text-sm font-medium">
          <span className="text-ink-muted">Admin</span>
          <Link href="/admin/vendors" className="text-ink hover:text-brand-500">
            Pending vendors
          </Link>
          <Link href="/admin/flagged-orders" className="text-ink hover:text-brand-500">
            Flagged orders
          </Link>
        </nav>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
