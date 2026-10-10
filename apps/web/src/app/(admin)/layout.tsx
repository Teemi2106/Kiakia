import { requireAdminContext } from "@/lib/auth/dal";
import Link from "next/link";
import { AdminNav } from "./_components/AdminNav";

/**
 * requireAdminContext() is the real gate for the (admin) group; proxy.ts only
 * proves "logged in". Every admin page and action re-checks it too, because
 * partial rendering means a client-side navigation doesn't re-run this layout.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminContext("/home");

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken md:flex-row">
      <aside className="border-b border-border bg-surface-raised md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <Link href="/admin" className="block px-4 py-3 text-base font-semibold text-ink md:py-5">
          KiaKia Admin
        </Link>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
