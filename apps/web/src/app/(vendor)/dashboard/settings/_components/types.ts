// app/(vendor)/settings/_components/types.ts
export interface VendorSettings {
  id: string;
  name: string;
  description: string | null;
  addressLine: string | null;
  landmark: string | null;
  avgPrepMins: number;
  minOrderKobo: number;
  deliveryRadiusM: number;
  isAcceptingOrders: boolean;
}
