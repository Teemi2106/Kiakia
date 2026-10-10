"use client";

import { Tabs } from "@kiakia/ui";
import { useRouter } from "next/navigation";

const ITEMS = [
  { value: "vendor", label: "Vendors" },
  { value: "rider", label: "Riders" },
  { value: "customer", label: "Customer wallets" },
] as const;

export function BalanceTabs({ value }: { readonly value: string }) {
  const router = useRouter();

  return <Tabs items={ITEMS} value={value} onValueChange={(next) => router.push(`/admin/finance?tab=${next}`)} />;
}
