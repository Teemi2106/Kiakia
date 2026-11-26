"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CustomerTopNav } from "./CustomerTopNav";

interface CustomerPageFrameProps {
  children: ReactNode;
  canSwitchToVendor: boolean;
  isFleetManager: boolean;
}

/** Keep the customer header on every desktop route and only mobile home. */
export function CustomerPageFrame({
  children,
  canSwitchToVendor,
  isFleetManager,
}: CustomerPageFrameProps) {
  const isHomePage = usePathname() === "/home";

  return (
    <>
      <div className={isHomePage ? "" : "hidden lg:block"}>
        <CustomerTopNav
          canSwitchToVendor={canSwitchToVendor}
          isFleetManager={isFleetManager}
        />
      </div>
      <main
        className={`flex-1 pb-(--kk-tabbar-h) ${
          isHomePage ? "pt-(--kk-nav-h)" : "pt-0 lg:pt-(--kk-nav-h)"
        }`}
      >
        {children}
      </main>
    </>
  );
}
