// app/(vendor)/orders/_components/types.ts
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
  total_kobo: number;
  created_at: string;
  customer_name?: string;
  customer_phone?: string;
  items?: OrderItem[];
  delivery_address?: string;
  customer_note?: string | null; // Allow null
  courier?: string;
  eta?: string;
  image?: string | null;
}

export interface Vendor {
  id: string;
  name: string;
}
