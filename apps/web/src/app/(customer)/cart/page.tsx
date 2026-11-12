// app/(customer)/cart/page.tsx
import type { Metadata } from "next";
import CustomerHomePage from "../home/page";
import type { HomeSearchParams } from "../home/_components/FilterChips";

export const metadata: Metadata = { title: "Cart" };

// A direct visit to /cart opens over the normal customer home surface.
export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  return <CustomerHomePage searchParams={searchParams} />;
}
