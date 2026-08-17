// app/(customer)/checkout/_components/types.ts
export interface Address {
  readonly id: string;
  readonly label: string | null;
  readonly line1: string;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly is_default: boolean;
}

export interface CartItem {
  readonly id: string;
  readonly name_snapshot: string;
  readonly qty: number;
  readonly line_total_kobo: number;
}

export interface Vendor {
  readonly name: string;
  readonly min_order_kobo: number;
  ProfileImage?: string | null;
}

export type PaymentMethod = "card" | "cash";
