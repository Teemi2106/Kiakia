// app/(customer)/layout.tsx
import { CustomerBottomNav } from "./_components/CustomerBottomNav";
import { CustomerTopNav } from "./_components/CustomerTopNav";
import { CartProvider } from "./cart/_components/CartProvider";
import { verifySession } from "@/lib/auth/dal";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Session verification stays on the server
  await verifySession();

  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
        <CustomerTopNav />
        <main className="flex-1">{children}</main>
        <CustomerBottomNav />
      </div>
    </CartProvider>
  );
}
