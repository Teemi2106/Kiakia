// app/(vendor)/history/_components/types.ts
export interface Order {
  id: string;
  code: string;
  status: string;
  total_kobo: number;
  created_at: string;
  customer_name?: string;
  items?: string;
}

export interface Vendor {
  id: string;
  name: string;
}
