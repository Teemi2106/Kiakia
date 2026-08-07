import {
  Bell,
  ShoppingCart,
  Search,
  Home,
  ClipboardList,
  History,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
    <div className="flex min-h-screen flex-col bg-[#FCF9F8]">
      {/* Top Navigation */}
      <CustomerTopNav />

      {/* Main Content */}
      <main className="flex-1 pt-[72px] sm:pt-[72px]">{children}</main>

      {/* Bottom Navigation (Mobile only) */}
      <CustomerBottomNav />
    </div>
  );
}
