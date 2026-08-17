// app/(customer)/tracking/_components/types.ts
export interface TimelineStep {
  id: string;
  label: string;
  time: string;
  status: "done" | "active" | "pending";
}

export interface Driver {
  name: string;
  rating: number;
  plateNumber: string;
  avatarUrl?: string;
  car?: string;
}

export interface Vendor {
  name: string;
  itemCount: number;
  logoUrl?: string;
}
