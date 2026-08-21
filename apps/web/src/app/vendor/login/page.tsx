// app/(vendor)/login/page.tsx
import type { Metadata } from "next";
import { vendorLoginAction } from "@/app/actions/auth";
import { VendorLoginDesktop } from "./_components/VendorLoginDesktop";
import { VendorLoginMobile } from "./_components/VendorLoginMobile";

export const metadata: Metadata = { title: "Vendor sign in" };

export default function VendorLoginPage() {
  return (
    <>
      <div className="hidden md:block">
        <VendorLoginDesktop />
      </div>
      <div className="md:hidden">
        <VendorLoginMobile />
      </div>
    </>
  );
}