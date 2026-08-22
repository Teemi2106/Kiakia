// app/(vendor)/dashboard/_components/types.ts
export interface Vendor {
  id: string;
  name: string;
  status: string;
  kyc_status: string;
  is_accepting_orders: boolean;
}

export interface Order {
  id: string;
  code: string;
  status: string;
  total_kobo: number;
  created_at: string;
  items?: string;
  eta?: string;
  image?: string | null;
}
