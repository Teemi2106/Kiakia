import { requireRole, VENDOR_ROLES, getVendorForCurrentUser } from "@/lib/auth/dal";
import { VendorBottomNav } from "./_components/VendorBottomNav";
import { VendorSidebar } from "./_components/VendorSidebar";

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  // Only vendor staff reach past this point — everyone else bounces to
  // /home. This is the real gate; proxy.ts only proved "logged in".
  await requireRole(VENDOR_ROLES, "/home");
  const vendor = await getVendorForCurrentUser();

  return (
    <div className="flex flex-1">
      {vendor && <VendorSidebar vendorName={vendor.name} />}
      <div className="flex flex-1 flex-col pb-16 sm:pb-0">
        {vendor && vendor.status !== "active" && (
          <div className="border-b border-warning bg-warning-surface px-4 py-2 text-center text-xs font-medium text-warning">
            Your store is {vendor.status === "pending" ? "pending review" : vendor.status} — it won&apos;t be visible to
            customers yet.
          </div>
        )}
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
      {vendor && <VendorBottomNav />}
    </div>
  );
}
