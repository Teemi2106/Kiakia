// app/(customer)/orders/[id]/_components/types.ts
export interface OrderDetail {
  id: string;
  code: string;
  status: string;
  payment_status: string;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  discount_kobo: number;
  total_kobo: number;
  delivery_address: unknown;
  delivery_note: string | null;
  delivery_code: string | null;
  vendor_id: string;
  /** True when the store itself delivers this order (no rider). */
  delivered_by_store?: boolean;
}

export interface Vendor {
  name: string;
  logo_url?: string | null;
}

export interface OrderItem {
  id: string;
  name_snapshot: string;
  qty: number;
  line_total_kobo: number;
  /** From menu_items.image_url (order_items itself has no image column) —
   * null when the menu item never had one, or was deleted since. */
  image_url: string | null;
}
