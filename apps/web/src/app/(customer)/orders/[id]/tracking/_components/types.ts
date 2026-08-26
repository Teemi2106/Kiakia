// app/(customer)/tracking/_components/types.ts
export interface TimelineStep {
  id: string;
  label: string;
  time: string;
  status: "done" | "active" | "pending";
}

// A rider isn't assigned to an order until dispatch (Phase 3, not yet
// built — see supabase/migrations/0002_identity.sql's header comment on
// `riders`), and the `riders` table only carries vehicle_type/plate_number,
// no rating. Every field here is therefore optional/real-data-only; there
// is no fabricated fallback.
export interface Driver {
  name: string;
  plateNumber?: string;
  avatarUrl?: string;
  car?: string;
}

export interface Vendor {
  name: string;
  itemCount: number;
  logoUrl?: string;
}
