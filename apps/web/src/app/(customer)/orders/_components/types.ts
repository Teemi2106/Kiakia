// app/(customer)/orders/_components/types.ts
export interface Order {
  id: string;
  code: string;
  status: string;
  total_kobo: number;
  vendor_id: string;
  created_at: string;
  delivery_address?: string;
  items?: Array<{ name: string; qty: number }>;
}

export interface Vendor {
  id: string;
  name: string;
  logo_url?: string | null;
}
