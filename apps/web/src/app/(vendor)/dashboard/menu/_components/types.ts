// app/(vendor)/menu/_components/types.ts
export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  name: string;
  category_id: string | null;
  price_kobo: number;
  is_available: boolean;
  sort_order: number;
  image_url?: string | null;
  description?: string | null;
}

export interface Vendor {
  id: string;
  name: string;
}
