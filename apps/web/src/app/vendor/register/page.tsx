// app/(vendor)/register/page.tsx
import { Card } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { vendorRegisterAction } from "@/app/actions/auth";
import { RegisterForm } from "@/app/(auth)/_components/RegisterForm";
import { VendorRegisterDesktop } from "./_components/VendorRegisterDesktop";
import { VendorRegisterMobile } from "./_components/VendorRegisterMobile";

export const metadata: Metadata = { title: "Become a Vendor" };

export default function VendorRegisterPage() {
  return (
    <>
      <div className="hidden px-7 md:block">
        <VendorRegisterDesktop />
      </div>
      <div className="md:hidden">
        <VendorRegisterMobile />
      </div>
    </>
  );
}