import { Bell, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { CustomerBottomNav } from "./_components/CustomerBottomNav";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  // Any authenticated user may browse as a customer — every signup gets
  // the 'customer' role by default (0002_identity.sql's on_auth_user_created
  // trigger), including vendor staff. No role gate beyond "logged in".
  await verifySession();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <Link href="/home" className="text-lg font-semibold text-brand-600">
          KiaKia
        </Link>
        <div className="flex items-center gap-4 text-ink-muted">
          {/* No unread-count badge: layouts don't re-fetch on the client-side
              cart writes elsewhere on this page, so a count here would go
              stale — an icon-only link avoids showing a wrong number. */}
          <Link href="/cart" aria-label="Cart" className="hover:text-ink">
            <ShoppingCart className="size-5" />
          </Link>
          <Bell className="size-5" aria-hidden="true" />
        </div>
      </header>
      <main className="flex flex-1 flex-col pb-20">{children}</main>
      <CustomerBottomNav />
    </div>
  );
}
