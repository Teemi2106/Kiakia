/**
 * Fixed preset cuisine categories a vendor picks from at onboarding
 * (vendors.category) — the same list drives the customer home page's
 * "Browse" chips (app/(customer)/home/_components/CategoryChips.tsx), so
 * every category is always browsable there, not just the ones an active
 * vendor happens to already have in the customer's state.
 */
export const VENDOR_CATEGORIES = [
  "African",
  "Rice",
  "Soups",
  "Swallow",
  "Grills",
  "Drinks",
  "Bakery",
  "Groceries",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
