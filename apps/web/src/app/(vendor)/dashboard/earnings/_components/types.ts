// app/(vendor)/earnings/_components/types.ts
export interface Payout {
  id: string;
  amount_kobo: number;
  direction: string;
  entry_type: string;
  created_at: string;
}

export interface Vendor {
  id: string;
  name: string;
}
