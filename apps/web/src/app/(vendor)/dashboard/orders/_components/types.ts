// app/(vendor)/orders/_components/types.ts
import type { VendorDispatchState } from "@/lib/vendor/self-delivery";

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price_kobo: number;
  image_url?: string | null;
  options?: string | null; // Allow null
}

export interface Order {
  id: string;
  code: string;
  status: string;
  subtotal_kobo?: number;
  delivery_fee_kobo?: number;
  total_kobo: number;
  created_at: string;
  customer_name?: string;
  customer_phone?: string;
  items?: OrderItem[];
  delivery_address?: string;
  customer_note?: string | null; // Allow null
  /** Who delivers: a KiaKia rider (default) or the store itself. */
  delivery_by?: "rider" | "vendor";
  /** Only for a ready order with no rider yet: what the dispatch is doing. */
  dispatch?: VendorDispatchState | null;
  courier?: string;
  eta?: string;
  image?: string | null;
}

export interface Vendor {
  id: string;
  name: string;
}
