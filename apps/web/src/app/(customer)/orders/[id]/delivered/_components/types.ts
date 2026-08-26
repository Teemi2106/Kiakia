// app/(customer)/orders/[id]/delivered/_components/types.ts
// A rider isn't assigned to an order until dispatch (Phase 3, not yet
// built — see supabase/migrations/0002_identity.sql's header comment on
// `riders`), and the `riders` table only carries vehicle_type/plate_number.
// Every field here is optional/real-data-only; there is no fabricated
// fallback.
export interface Driver {
  name: string;
  vehicle?: string;
  plateNumber?: string;
  avatarUrl?: string;
}
