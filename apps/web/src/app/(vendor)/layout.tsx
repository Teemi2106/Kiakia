import { requireVendorContext, getVendorForCurrentUser } from "@/lib/auth/dal";
import { VendorBottomNav } from "./_components/VendorBottomNav";
import { VendorSidebar } from "./_components/VendorSidebar";
import { VendorTopNav } from "./_components/VendorTopNav";

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Only a session that (a) holds a vendor role AND (b) has explicitly
  // switched into vendor mode reaches past this point — everyone else
  // bounces to /home. This is the real gate; proxy.ts only proved
  // "logged in". See requireVendorContext() for why holding the role alone
  // isn't enough (a customer who also owns a store must not land here just
  // by typing the URL).
  await requireVendorContext("/home");
  const vendor = await getVendorForCurrentUser();

  return (
    <div className="flex flex-1 overflow-x-hidden max-w-full">
      {vendor && (
        <VendorSidebar
          vendorName={vendor.name}
          bannerUrl={vendor.banner_url}
          status={vendor.status}
        />
      )}
      <div>
        <VendorTopNav />
      </div>
      <div className="flex flex-1 flex-col pb-16 pt-14 sm:pb-0 sm:pt-[63px] min-w-0 max-w-full">
        {vendor && vendor.status !== "active" && (
          <div className="border-b border-warning bg-warning-surface px-4 py-2 text-center text-xs font-medium text-warning">
            Your store is{" "}
            {vendor.status === "pending" ? "pending review" : vendor.status} —
            it won&apos;t be visible to customers yet.
          </div>
        )}
        <main className="flex flex-1 flex-col overflow-x-hidden max-w-full">
          {children}
        </main>
      </div>
      {vendor && <VendorBottomNav />}
    </div>
  );
}
