import { verifySession } from "@/lib/auth/dal";
import { CustomerBottomNav } from "./_components/CustomerBottomNav";
import { CustomerTopNav } from "./_components/CustomerTopNav";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Any authenticated user may browse as a customer — every signup gets
  // the 'customer' role by default (0002_identity.sql's on_auth_user_created
  // trigger), including vendor staff. No role gate beyond "logged in".
  await verifySession();

  return (
    // Remove any relative positioning or z-index from parent containers
    <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
      <CustomerTopNav />
      <main className="flex-1">{children}</main>
      <CustomerBottomNav />
    </div>
  );
}
