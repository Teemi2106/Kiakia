import { redirect } from "next/navigation";
import { getOptionalSession, getRoles, hasRole, VENDOR_ROLES } from "@/lib/auth/dal";

export default async function VendorAuthLayout({ children }: { children: React.ReactNode }) {
  // Mirrors (auth)/layout.tsx's "already signed in? skip the form" bounce,
  // but an existing vendor lands on /dashboard while everyone else (a
  // signed-in customer with no vendor role yet) lands on /onboarding —
  // never /home, since these are the vendor entry points.
  const session = await getOptionalSession();
  if (session) {
    const roles = await getRoles();
    redirect(hasRole(roles, ...VENDOR_ROLES) ? "/dashboard" : "/onboarding");
  }

  return (
     <main className="flex min-h-screen flex-1 items-center justify-center bg-[#FCF9F8] p-4 md:p-6">
      <div className="w-full max-w-7xl">{children}</div>
    </main>
  );
}
