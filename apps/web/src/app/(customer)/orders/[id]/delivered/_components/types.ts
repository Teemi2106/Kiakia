// app/(customer)/orders/[id]/delivered/_components/types.ts
export interface Driver {
  name: string;
  vehicle: string;
  plateNumber: string;
  avatarUrl?: string;
}

export interface OrderDelivered {
  id: string;
  code: string;
  deliveryCode: string;
  driver: Driver;
  vendorName: string;
  items: Array<{ name: string; qty: number }>;
}
