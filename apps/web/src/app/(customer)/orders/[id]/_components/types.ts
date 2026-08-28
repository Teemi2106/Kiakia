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
}
