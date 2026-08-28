/**
 * PLACEHOLDER — hand-authored to mirror supabase/migrations/*.sql exactly,
 * because there is no live Supabase project to run the real generator
 * against yet. The moment one exists, replace this file's contents with:
 *
 *   pnpm --filter @kiakia/db gen:types
 *
 * (which runs `supabase gen types typescript --local --schema public`).
 * Do not hand-edit this file after that point — it is generated.
 *
 * Every Row/Insert/Update below is written out independently rather than
 * derived with `Omit<Database[...]["Row"]>` / `Partial<Database[...]["Insert"]>`
 * self-references — which is also what the real generator does. An earlier
 * draft used those self-referential derivations and, once enough tables
 * accumulated, silently collapsed every `.select()` result to `never`
 * (TypeScript quietly gives up past a certain conditional-type complexity
 * ceiling rather than erroring) — independent literal types avoid the
 * whole class of problem.
 *
 * Geography columns (`geography(Point,4326)` / `geography(Polygon,4326)`)
 * come back over PostgREST as GeoJSON-ish text; typed as `string` here and
 * parsed at the call site, matching what the real generator would produce.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Role bundles per kiakia-system-architecture.md §13. */
export type Role =
  | "customer"
  | "vendor_staff"
  | "vendor_manager"
  | "vendor_owner"
  | "rider"
  | "support"
  | "finance"
  | "admin"
  | "superadmin";

/**
 * Standalone (not self-referential — see the file header's `never`-collapse
 * story) so it can be reused both for `Tables.orders.Row` and for the
 * return type of every RPC that hands back a full order
 * (`transition_order`, `place_order`, `capture_payment`).
 *
 * No `delivery_code` field — that column was dropped from `orders` entirely
 * (supabase/migrations/0022_delivery_code_off_orders.sql, independent
 * security review round 3, blocking finding 1: every SECURITY DEFINER
 * function that `returns orders` bypasses column-level grants as the
 * function owner, so the code was readable by the assigned rider the
 * instant they accepted a dispatch offer). See the standalone
 * `OrderDeliveryCodeRow` type below, sourced from the new
 * `order_delivery_codes` table instead.
 */
export interface OrderRow {
  id: string;
  code: string;
  customer_id: string;
  vendor_id: string;
  rider_id: string | null;
  service_area_id: string | null;
  status: OrderStatus;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  service_fee_kobo: number;
  discount_kobo: number;
  total_kobo: number;
  payment_method: "card" | "bank_transfer" | "ussd" | "wallet" | null;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  promo_code: string | null;
  delivery_address: Json;
  delivery_location: string;
  delivery_note: string | null;
  distance_m: number | null;
  rider_fee_kobo: number;
  rider_pickup_distance_m: number | null;
  placed_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  assigned_at: string | null;
  picked_up_at: string | null;
  in_transit_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Return type of verify_delivery_and_release_escrow()
 * (supabase/migrations/0025_fix_delivery_code_rate_limit_persistence.sql),
 * mirroring the new `delivery_verification_result` composite SQL type. A
 * real `supabase gen types` run would nest this under
 * `Database["public"]["CompositeTypes"]["delivery_verification_result"]`
 * rather than as a standalone interface — hand-authored as a flat type
 * here instead, same divergence-for-simplicity already taken for OrderRow/
 * VendorRow above, since there is exactly one function that returns it.
 *
 * `code_matched: false` is a NORMAL, non-exceptional result (the rider
 * mistyped the 4-digit code) — `order_row` is the order UNCHANGED, still
 * 'arrived'. It is NOT thrown as a Postgres error the way it used to be —
 * see the migration's own header: the old exception-based path silently
 * discarded the rate-limit counter it was supposed to feed, because the
 * insert recording the failed attempt was always rolled back by the raise
 * that followed it in the same transaction. Any caller (the rider app —
 * not yet in this repo) must branch on `code_matched` explicitly rather
 * than relying on a caught/uncaught error for this case. The rate-limit-
 * exceeded case and every other precondition failure (wrong rider, wrong
 * status, unpaid, no code, escrow mismatch) are UNCHANGED — still thrown
 * as Postgres exceptions.
 */
export interface DeliveryVerificationResult {
  code_matched: boolean;
  order_row: OrderRow;
}

/**
 * order_delivery_codes (0022_delivery_code_off_orders.sql) — the rider
 * handover code, formerly `orders.delivery_code`. Readable only by the
 * order's own customer via RLS (never the assigned rider, never vendor
 * staff) — see that migration's table comment.
 */
export interface OrderDeliveryCodeRow {
  order_id: string;
  code: string;
  created_at: string;
}

/** Standalone for the same reason as OrderRow — reused by `register_vendor`'s return type. */
export interface VendorRow {
  id: string;
  owner_user_id: string;
  service_area_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  address_line: string | null;
  landmark: string | null;
  state: string | null;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  logo_url: string | null;
  banner_url: string | null;
  status: "pending" | "active" | "suspended";
  kyc_status: "pending" | "approved" | "rejected";
  opening_hours: Json;
  avg_prep_mins: number;
  min_order_kobo: number;
  delivery_radius_m: number;
  commission_bps: number;
  is_accepting_orders: boolean;
  rating_avg: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Standalone (same reasoning as OrderRow/VendorRow above) — reused by
 * register_rider / set_rider_online / approve_rider / reject_rider's return
 * types (0026_rider_self_service.sql, 0027_rider_kyc_admin_approval.sql).
 */
export interface RiderRow {
  user_id: string;
  vehicle_type: string | null;
  plate_number: string | null;
  kyc_status: "pending" | "approved" | "rejected";
  is_online: boolean;
  current_location: string | null;
  last_ping_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderStatus =
  | "draft"
  | "placed"
  | "accepted"
  | "rejected_by_vendor"
  | "preparing"
  | "ready_for_pickup"
  | "rider_assigned"
  | "picked_up"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "failed_delivery"
  | "cancelled_by_customer"
  | "cancelled_by_platform";

export interface Database {
  public: {
    Tables: {
      notifications: {
        Row: {
          id: string;
          customer_id: string;
          order_id: string | null;
          title: string;
          body: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          order_id?: string | null;
          title: string;
          body: string;
          is_read?: boolean;
        };
        Update: {
          id?: string;
          customer_id?: string;
          order_id?: string | null;
          title?: string;
          body?: string;
          is_read?: boolean;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          phone: string | null;
          full_name: string | null;
          avatar_url: string | null;
          status: "active" | "suspended" | "deleted";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          phone?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          status?: "active" | "suspended" | "deleted";
        };
        Update: {
          id?: string;
          phone?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          status?: "active" | "suspended" | "deleted";
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          user_id: string;
          role: Role;
          scope_type: "platform" | "vendor";
          scope_id: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role: Role;
          scope_type?: "platform" | "vendor";
          scope_id?: string | null;
        };
        Update: {
          user_id?: string;
          role?: Role;
          scope_type?: "platform" | "vendor";
          scope_id?: string | null;
        };
        Relationships: [];
      };
      addresses: {
        Row: {
          id: string;
          customer_id: string;
          label: string | null;
          line1: string;
          landmark: string | null;
          city: string;
          state: string;
          location: string;
          location_lat: number | null;
          location_lng: number | null;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          label?: string | null;
          line1: string;
          landmark?: string | null;
          city?: string;
          state?: string;
          location: string;
          location_lat?: number | null;
          location_lng?: number | null;
          is_default?: boolean;
        };
        Update: {
          id?: string;
          customer_id?: string;
          label?: string | null;
          line1?: string;
          landmark?: string | null;
          city?: string;
          state?: string;
          location?: string;
          location_lat?: number | null;
          location_lng?: number | null;
          is_default?: boolean;
        };
        Relationships: [];
      };
      riders: {
        Row: {
          user_id: string;
          vehicle_type: string | null;
          plate_number: string | null;
          kyc_status: "pending" | "approved" | "rejected";
          is_online: boolean;
          current_location: string | null;
          last_ping_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          vehicle_type?: string | null;
          plate_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          is_online?: boolean;
          current_location?: string | null;
          last_ping_at?: string | null;
        };
        Update: {
          user_id?: string;
          vehicle_type?: string | null;
          plate_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          is_online?: boolean;
          current_location?: string | null;
          last_ping_at?: string | null;
        };
        Relationships: [];
      };
      service_areas: {
        Row: {
          id: string;
          name: string;
          polygon: string;
          is_active: boolean;
          base_delivery_fee_kobo: number;
          per_km_fee_kobo: number;
          free_above_kobo: number | null;
          // rider_base_fee_kobo/rider_per_km_fee_kobo (0044) are
          // column-REVOKEd from anon/authenticated — internal payout
          // economics, not customer-facing. Present here for service_role
          // callers only; a real generator run against RLS-aware grants
          // would still list them (column grants aren't RLS), so this
          // matches what `supabase gen types` would actually emit.
          rider_base_fee_kobo: number;
          rider_per_km_fee_kobo: number;
          launched_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          polygon: string;
          is_active?: boolean;
          base_delivery_fee_kobo: number;
          per_km_fee_kobo: number;
          free_above_kobo?: number | null;
          rider_base_fee_kobo?: number;
          rider_per_km_fee_kobo?: number;
          launched_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          polygon?: string;
          is_active?: boolean;
          base_delivery_fee_kobo?: number;
          per_km_fee_kobo?: number;
          free_above_kobo?: number | null;
          rider_base_fee_kobo?: number;
          rider_per_km_fee_kobo?: number;
          launched_at?: string | null;
        };
        Relationships: [];
      };
      vendors: {
        Row: {
          id: string;
          owner_user_id: string;
          service_area_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          category: string;
          address_line: string | null;
          landmark: string | null;
          state: string | null;
          location: string | null;
          location_lat: number | null;
          location_lng: number | null;
          logo_url: string | null;
          banner_url: string | null;
          status: "pending" | "active" | "suspended";
          kyc_status: "pending" | "approved" | "rejected";
          opening_hours: Json;
          avg_prep_mins: number;
          min_order_kobo: number;
          delivery_radius_m: number;
          commission_bps: number;
          is_accepting_orders: boolean;
          rating_avg: number;
          rating_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          service_area_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          category?: string;
          address_line?: string | null;
          landmark?: string | null;
          state?: string | null;
          location?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          logo_url?: string | null;
          banner_url?: string | null;
          status?: "pending" | "active" | "suspended";
          kyc_status?: "pending" | "approved" | "rejected";
          opening_hours?: Json;
          avg_prep_mins?: number;
          min_order_kobo?: number;
          delivery_radius_m?: number;
          commission_bps?: number;
          is_accepting_orders?: boolean;
          rating_avg?: number;
          rating_count?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          service_area_id?: string | null;
          name?: string;
          slug?: string;
          description?: string | null;
          category?: string;
          address_line?: string | null;
          landmark?: string | null;
          state?: string | null;
          location?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          logo_url?: string | null;
          banner_url?: string | null;
          status?: "pending" | "active" | "suspended";
          kyc_status?: "pending" | "approved" | "rejected";
          opening_hours?: Json;
          avg_prep_mins?: number;
          min_order_kobo?: number;
          delivery_radius_m?: number;
          commission_bps?: number;
          is_accepting_orders?: boolean;
          rating_avg?: number;
          rating_count?: number;
        };
        Relationships: [];
      };
      vendor_staff: {
        Row: {
          vendor_id: string;
          user_id: string;
          role: "vendor_staff" | "vendor_manager" | "vendor_owner";
          created_at: string;
        };
        Insert: {
          vendor_id: string;
          user_id: string;
          role: "vendor_staff" | "vendor_manager" | "vendor_owner";
        };
        Update: {
          vendor_id?: string;
          user_id?: string;
          role?: "vendor_staff" | "vendor_manager" | "vendor_owner";
        };
        Relationships: [];
      };
      menu_categories: {
        Row: {
          id: string;
          vendor_id: string;
          category_key: string;
          sort_order: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          category_key: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          category_key?: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      menu_items: {
        Row: {
          id: string;
          vendor_id: string;
          category_id: string | null;
          name: string;
          description: string | null;
          image_url: string | null;
          price_kobo: number;
          prep_mins: number | null;
          is_available: boolean;
          sort_order: number;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          category_id?: string | null;
          name: string;
          description?: string | null;
          image_url?: string | null;
          price_kobo: number;
          prep_mins?: number | null;
          is_available?: boolean;
          sort_order?: number;
          tags?: string[];
        };
        Update: {
          id?: string;
          vendor_id?: string;
          category_id?: string | null;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          price_kobo?: number;
          prep_mins?: number | null;
          is_available?: boolean;
          sort_order?: number;
          tags?: string[];
        };
        Relationships: [];
      };
      option_groups: {
        Row: {
          id: string;
          menu_item_id: string;
          name: string;
          min_select: number;
          max_select: number;
          is_required: boolean;
        };
        Insert: {
          id?: string;
          menu_item_id: string;
          name: string;
          min_select?: number;
          max_select?: number;
          is_required?: boolean;
        };
        Update: {
          id?: string;
          menu_item_id?: string;
          name?: string;
          min_select?: number;
          max_select?: number;
          is_required?: boolean;
        };
        Relationships: [];
      };
      options: {
        Row: {
          id: string;
          group_id: string;
          name: string;
          price_delta_kobo: number;
          is_available: boolean;
        };
        Insert: {
          id?: string;
          group_id: string;
          name: string;
          price_delta_kobo?: number;
          is_available?: boolean;
        };
        Update: {
          id?: string;
          group_id?: string;
          name?: string;
          price_delta_kobo?: number;
          is_available?: boolean;
        };
        Relationships: [];
      };
      carts: {
        Row: {
          id: string;
          customer_id: string;
          vendor_id: string | null;
          status: "open" | "converted" | "abandoned";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          vendor_id?: string | null;
          status?: "open" | "converted" | "abandoned";
        };
        Update: {
          id?: string;
          customer_id?: string;
          vendor_id?: string | null;
          status?: "open" | "converted" | "abandoned";
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          id: string;
          cart_id: string;
          menu_item_id: string;
          name_snapshot: string;
          unit_price_kobo: number;
          qty: number;
          options_snapshot: Json;
          line_total_kobo: number;
        };
        Insert: {
          id?: string;
          cart_id: string;
          menu_item_id: string;
          name_snapshot: string;
          unit_price_kobo: number;
          qty: number;
          options_snapshot?: Json;
          line_total_kobo: number;
        };
        Update: {
          id?: string;
          cart_id?: string;
          menu_item_id?: string;
          name_snapshot?: string;
          unit_price_kobo?: number;
          qty?: number;
          options_snapshot?: Json;
          line_total_kobo?: number;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          code: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          service_area_id: string | null;
          status: OrderStatus;
          subtotal_kobo: number;
          delivery_fee_kobo: number;
          service_fee_kobo: number;
          discount_kobo: number;
          total_kobo: number;
          payment_method: "card" | "bank_transfer" | "ussd" | "wallet" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
          rider_fee_kobo: number;
          rider_pickup_distance_m: number | null;
          placed_at: string | null;
          accepted_at: string | null;
          ready_at: string | null;
          assigned_at: string | null;
          picked_up_at: string | null;
          in_transit_at: string | null;
          arrived_at: string | null;
          delivered_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // status defaults to 'draft' and is thereafter only ever changed by
        // calling the transition_order() RPC — see §10. Insert deliberately
        // omits it (and every transition timestamp) so application code
        // cannot set them directly; Update is `never` for the same reason.
        // No `delivery_code` field — dropped entirely, see OrderRow's own
        // doc comment and 0022_delivery_code_off_orders.sql.
        Insert: {
          id?: string;
          customer_id: string;
          vendor_id: string;
          rider_id?: string | null;
          service_area_id?: string | null;
          subtotal_kobo: number;
          delivery_fee_kobo?: number;
          service_fee_kobo?: number;
          discount_kobo?: number;
          total_kobo: number;
          payment_method?: "card" | "bank_transfer" | "ussd" | "wallet" | null;
          payment_status?: "pending" | "paid" | "failed" | "refunded";
          promo_code?: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note?: string | null;
          distance_m?: number | null;
        };
        Update: never;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          menu_item_id: string;
          name_snapshot: string;
          unit_price_kobo: number;
          qty: number;
          options_snapshot: Json;
          line_total_kobo: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id: string;
          name_snapshot: string;
          unit_price_kobo: number;
          qty: number;
          options_snapshot?: Json;
          line_total_kobo: number;
        };
        Update: never;
        Relationships: [];
      };
      order_events: {
        Row: {
          id: string;
          order_id: string;
          from_status: OrderStatus | null;
          to_status: OrderStatus;
          actor_type: "customer" | "vendor" | "rider" | "system" | "admin";
          actor_id: string | null;
          at: string;
          meta: Json;
        };
        Insert: never; // written exclusively by transition_order()
        Update: never;
        Relationships: [];
      };
      accounts: {
        Row: {
          id: string;
          owner_type: "platform" | "vendor" | "rider" | "customer";
          owner_id: string | null;
          kind: "escrow" | "available" | "pending_payout" | "revenue" | "gateway" | "wallet";
          currency: "NGN";
          created_at: string;
        };
        Insert: never; // service-role only
        Update: never;
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          kind: "payment_capture" | "escrow_release" | "payout" | "refund" | "adjustment";
          reference: string;
          order_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: never; // service-role only
        Update: never;
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          id: string;
          transaction_id: string;
          account_id: string;
          direction: "debit" | "credit";
          amount_kobo: number;
          entry_type: string;
          order_id: string | null;
          created_at: string;
        };
        Insert: never; // service-role only
        Update: never;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          order_id: string;
          provider: "monnify" | "flutterwave";
          provider_ref: string;
          amount_kobo: number;
          channel: "card" | "bank_transfer" | "ussd" | null;
          status: "pending" | "success" | "failed" | "refunded";
          raw: Json;
          idempotency_key: string;
          // Monnify's OWN refund state (0043_monnify_refund_tracking.sql) —
          // distinct from `status`/orders.payment_status = 'refunded', which
          // only mean KiaKia's internal ledger was reversed. Set by the app
          // layer (lib/monnify-refund.ts) after actually calling Monnify's
          // initiate-refund API, never by a SQL function.
          refund_reference: string | null;
          refund_status: "pending" | "completed" | "failed" | null;
          created_at: string;
        };
        // The only ledger-adjacent table inserted directly via the JS admin
        // client rather than exclusively inside a SQL function: the
        // Server Action that places an order records the 'pending' row
        // right after Monnify's init-transaction call succeeds. Everything
        // that touches the payment's SUCCESS state (marking it 'success',
        // opening the ledger transaction) still happens exclusively inside
        // capture_payment() in raw SQL — Update deliberately does NOT
        // include `status` here, so nothing outside that function can flip
        // it. The one narrow exception: initializePaymentForOrder()
        // (app/actions/orders.ts) refreshes provider_ref/amount_kobo on a
        // still-'pending' row when a retry reuses the same idempotency_key,
        // scoped with `.eq("status", "pending")` at the call site so it can
        // never touch an already-captured row — hence Update only exposes
        // those two fields, not the full row.
        Insert: {
          id?: string;
          order_id: string;
          provider?: "monnify" | "flutterwave";
          provider_ref: string;
          amount_kobo: number;
          channel?: "card" | "bank_transfer" | "ussd" | null;
          status?: "pending" | "success" | "failed" | "refunded";
          raw?: Json;
          idempotency_key: string;
          refund_reference?: string | null;
          refund_status?: "pending" | "completed" | "failed" | null;
        };
        Update: {
          provider_ref?: string;
          amount_kobo?: number;
          // Deliberately exposed here (unlike `status` above) — the app
          // layer is the only writer of these two, via lib/monnify-refund.ts.
          refund_reference?: string | null;
          refund_status?: "pending" | "completed" | "failed" | null;
        };
        Relationships: [];
      };
      dispatch_offers: {
        Row: {
          id: string;
          order_id: string;
          rider_id: string;
          status: "offered" | "accepted" | "expired" | "declined";
          offered_at: string;
          responded_at: string | null;
        };
        // Written only by dispatch_order_to_nearby_riders() (the
        // ready_for_pickup trigger) and accept_dispatch_offer() — no
        // authenticated-reachable write path exists (0019_rider_dispatch.sql).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      order_delivery_codes: {
        Row: {
          order_id: string;
          code: string;
          created_at: string;
        };
        // Written only by place_order() — no authenticated-reachable write
        // path exists. SELECT is scoped by RLS to the order's own customer
        // ONLY, never the assigned rider or vendor staff — see
        // 0022_delivery_code_off_orders.sql (independent security review,
        // round 3, blocking finding 1).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      order_rider_locations: {
        Row: {
          order_id: string;
          rider_id: string;
          lat: number;
          lng: number;
          updated_at: string;
        };
        // Written only by update_rider_location() (SECURITY DEFINER) and
        // deleted by a trigger on the order's terminal transition — no
        // authenticated-reachable write path exists at all
        // (0026_rider_self_service.sql). SELECT is scoped by RLS to the
        // order's own customer, that order's vendor staff, or an admin.
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      account_balances: {
        Row: {
          account_id: string;
          balance_kobo: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      transition_order: {
        Args: {
          p_order_id: string;
          p_to_status: OrderStatus;
          p_actor_type: "customer" | "vendor" | "rider" | "system" | "admin";
          p_actor_id: string;
          p_meta?: Json;
        };
        Returns: {
          id: string;
          code: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          service_area_id: string | null;
          status: OrderStatus;
          subtotal_kobo: number;
          delivery_fee_kobo: number;
          service_fee_kobo: number;
          discount_kobo: number;
          total_kobo: number;
          payment_method: "card" | "bank_transfer" | "ussd" | "wallet" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
          rider_fee_kobo: number;
          rider_pickup_distance_m: number | null;
          placed_at: string | null;
          accepted_at: string | null;
          ready_at: string | null;
          assigned_at: string | null;
          picked_up_at: string | null;
          in_transit_at: string | null;
          arrived_at: string | null;
          delivered_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      place_order: {
        Args: {
          p_cart_id: string;
          p_delivery_address: Json;
          p_delivery_location: string;
          p_delivery_note?: string | null;
        };
        Returns: {
          id: string;
          code: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          service_area_id: string | null;
          status: OrderStatus;
          subtotal_kobo: number;
          delivery_fee_kobo: number;
          service_fee_kobo: number;
          discount_kobo: number;
          total_kobo: number;
          payment_method: "card" | "bank_transfer" | "ussd" | "wallet" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
          rider_fee_kobo: number;
          rider_pickup_distance_m: number | null;
          placed_at: string | null;
          accepted_at: string | null;
          ready_at: string | null;
          assigned_at: string | null;
          picked_up_at: string | null;
          in_transit_at: string | null;
          arrived_at: string | null;
          delivered_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      register_vendor: {
        Args: {
          p_name: string;
          p_slug: string;
          p_category: string;
          p_description?: string | null;
          p_address_line?: string | null;
          p_landmark?: string | null;
          p_location?: string | null;
          p_service_area_id?: string | null;
          p_state?: string | null;
        };
        Returns: {
          id: string;
          owner_user_id: string;
          service_area_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          category: string;
          address_line: string | null;
          landmark: string | null;
          state: string | null;
          location: string | null;
          location_lat: number | null;
          location_lng: number | null;
          logo_url: string | null;
          banner_url: string | null;
          status: "pending" | "active" | "suspended";
          kyc_status: "pending" | "approved" | "rejected";
          opening_hours: Json;
          avg_prep_mins: number;
          min_order_kobo: number;
          delivery_radius_m: number;
          commission_bps: number;
          is_accepting_orders: boolean;
          rating_avg: number;
          rating_count: number;
          created_at: string;
          updated_at: string;
        };
      };
      capture_payment: {
        Args: {
          p_order_id: string;
          p_provider: "monnify" | "flutterwave";
          p_provider_ref: string;
          p_amount_kobo: number;
          p_raw: Json;
          p_idempotency_key: string;
          p_channel?: "card" | "bank_transfer" | "ussd" | null;
        };
        Returns: {
          id: string;
          code: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          service_area_id: string | null;
          status: OrderStatus;
          subtotal_kobo: number;
          delivery_fee_kobo: number;
          service_fee_kobo: number;
          discount_kobo: number;
          total_kobo: number;
          payment_method: "card" | "bank_transfer" | "ussd" | "wallet" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
          rider_fee_kobo: number;
          rider_pickup_distance_m: number | null;
          placed_at: string | null;
          accepted_at: string | null;
          ready_at: string | null;
          assigned_at: string | null;
          picked_up_at: string | null;
          in_transit_at: string | null;
          arrived_at: string | null;
          delivered_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      // accept_dispatch_offer (0019_rider_dispatch.sql) reuses OrderRow
      // directly for Returns (unlike transition_order/place_order/
      // capture_payment above, which duplicate the order shape inline) —
      // OrderRow exists precisely so a full-order-returning RPC doesn't
      // have to; see this file's OrderRow doc comment.
      accept_dispatch_offer: {
        Args: {
          p_order_id: string;
        };
        Returns: OrderRow;
      };
      // verify_delivery_and_release_escrow no longer returns OrderRow
      // directly as of 0025_fix_delivery_code_rate_limit_persistence.sql —
      // see DeliveryVerificationResult's doc comment for why (an incorrect
      // delivery code stopped being an exception and became a normal,
      // discriminated result, so the rate-limiting event it logs can no
      // longer be lost to that exception's own rollback).
      verify_delivery_and_release_escrow: {
        Args: {
          p_order_id: string;
          p_delivery_code: string;
        };
        Returns: DeliveryVerificationResult;
      };
      // approve_vendor / reject_vendor (0021_admin_vendor_approval.sql) —
      // SECURITY DEFINER, granted to service_role only, never to
      // authenticated. Called exclusively from an admin Server Action via
      // createAdminClient() (lib/supabase/admin.ts), after that action's own
      // DAL check (a requireAdminContext()-equivalent — see this repo's
      // supabase/migrations/0021_admin_vendor_approval.sql footer note for
      // the exact shape) verifies the caller holds admin/superadmin. This
      // stub's shape (p_vendor_id/p_actor_id -> VendorRow) matches the
      // migration that now actually defines both functions.
      approve_vendor: {
        Args: {
          p_vendor_id: string;
          p_actor_id: string;
        };
        Returns: VendorRow;
      };
      reject_vendor: {
        Args: {
          p_vendor_id: string;
          p_actor_id: string;
        };
        Returns: VendorRow;
      };
      // register_rider / set_rider_online / update_rider_location /
      // decline_dispatch_offer / get_order_tracking
      // (0026_rider_self_service.sql, 0029_order_tracking.sql) — the rider
      // self-service surface the separate rider mobile app calls directly
      // with its own JWT. No UI in this repo calls these.
      register_rider: {
        Args: {
          p_vehicle_type: string;
          p_plate_number: string;
        };
        Returns: RiderRow;
      };
      set_rider_online: {
        Args: {
          p_is_online: boolean;
        };
        Returns: RiderRow;
      };
      update_rider_location: {
        Args: {
          p_lat: number;
          p_lng: number;
        };
        Returns: undefined;
      };
      decline_dispatch_offer: {
        Args: {
          p_order_id: string;
        };
        Returns: {
          id: string;
          order_id: string;
          rider_id: string;
          status: "offered" | "accepted" | "expired" | "declined";
          offered_at: string;
          responded_at: string | null;
        };
      };
      // Locked-contract return shape (0029_order_tracking.sql) — a parallel
      // frontend-dev pass builds the tracking page against this exact
      // column set; do not rename/reorder without coordinating.
      get_order_tracking: {
        Args: {
          p_order_id: string;
        };
        Returns: {
          status: string;
          vendor_lat: number | null;
          vendor_lng: number | null;
          destination_lat: number | null;
          destination_lng: number | null;
          rider_lat: number | null;
          rider_lng: number | null;
          rider_updated_at: string | null;
        };
      };
      // approve_rider / reject_rider (0027_rider_kyc_admin_approval.sql) — mirrors
      // approve_vendor/reject_vendor above exactly: SECURITY DEFINER,
      // service_role only, never granted to authenticated. Called
      // exclusively from an admin Server Action via createAdminClient()
      // after requireAdminContext() has already verified the caller.
      approve_rider: {
        Args: {
          p_rider_id: string;
          p_actor_id: string;
        };
        Returns: RiderRow;
      };
      reject_rider: {
        Args: {
          p_rider_id: string;
          p_actor_id: string;
        };
        Returns: RiderRow;
      };
      // set_vendor_location (0032_vendor_location_and_rider_reads.sql) —
      // closes the gap where vendors.location could never be set after
      // registration, which silently made dispatch_order_to_nearby_riders()
      // return early and offer the order to nobody. Granted to
      // `authenticated`; the RPC itself verifies vendor_staff membership.
      set_vendor_location: {
        Args: {
          p_vendor_id: string;
          p_lat: number;
          p_lng: number;
        };
        Returns: VendorRow;
      };
      // get_rider_offer_details (0032) — lets a rider see what a dispatch
      // offer actually IS before accepting, without broadening `orders` RLS.
      // Deliberately does NOT expose the customer's delivery_code (that lives
      // in order_delivery_codes, customer-only — it is the anti-fraud anchor
      // for escrow release and must never be rider-readable).
      //
      // Modelled as a plain object rather than `[]`, same convention as
      // get_order_tracking above: it is a `returns table` function that yields
      // at most one row, so callers use `.single()` and cast. Consumed by the
      // SEPARATE rider app, not by anything in this repo.
      get_rider_offer_details: {
        Args: {
          p_order_id: string;
        };
        Returns: {
          order_code: string;
          status: string;
          vendor_name: string;
          vendor_address_line: string | null;
          vendor_landmark: string | null;
          pickup_lat: number | null;
          pickup_lng: number | null;
          dropoff_lat: number | null;
          dropoff_lng: number | null;
          delivery_address: Json;
          delivery_note: string | null;
          item_count: number;
          total_kobo: number;
          delivery_fee_kobo: number;
          distance_m: number | null;
          // pickup_distance_m/rider_fee_estimate_kobo (0044) — a live,
          // non-authoritative estimate of the rider's own trip pay, NULL
          // whenever the rider's current_location, the vendor's location,
          // or the order's service area rates are missing. The
          // authoritative number is orders.rider_fee_kobo, set by
          // accept_dispatch_offer() at accept time.
          pickup_distance_m: number | null;
          rider_fee_estimate_kobo: number | null;
        };
      };
      // get_rider_earnings (0032) — riders could not see their own balances at
      // all: accounts/ledger_entries have every privilege revoked from
      // `authenticated` (0007_rls.sql) and account_balances was locked down in
      // 0024. Unlike the two table-returning functions above, this genuinely
      // returns MULTIPLE rows (one per account kind), so it is modelled as an
      // array and callers must NOT use `.single()`.
      get_rider_earnings: {
        Args: Record<string, never>;
        Returns: {
          account_kind: string;
          balance_kobo: number;
        }[];
      };
      // refund_order_escrow / admin_reset_delivery_code_attempts
      // (0031_refund_and_escrow_unwind.sql) — the two paths that un-strand
      // money. Before 0031, escrow could only ever leave via a successful
      // delivery, so a cancelled order or an order locked out after 5 wrong
      // delivery-code attempts held its payment forever. Both are
      // service_role-only with a real admin/superadmin actor row, same shape
      // as approve_vendor/approve_rider — never grant to authenticated.
      refund_order_escrow: {
        Args: {
          p_order_id: string;
          p_actor_id: string;
          p_reason: string;
          /** 0045_customer_wallet.sql — defaults to "wallet" server-side. */
          p_destination?: "wallet" | "gateway";
        };
        Returns: OrderRow;
      };

      // The customer wallet (0045_customer_wallet.sql). pay_order_from_wallet
      // and both read functions are granted to `authenticated` — unlike every
      // other money RPC here — because they act only on the caller's own
      // wallet and re-derive the caller, the amount and the balance
      // server-side from auth.uid().
      pay_order_from_wallet: {
        Args: {
          p_order_id: string;
        };
        Returns: OrderRow;
      };
      get_wallet_balance: {
        // Deliberately argument-less: there is no parameter that could point
        // it at another user's wallet.
        Args: Record<string, never>;
        Returns: number;
      };
      get_wallet_transactions: {
        Args: {
          p_limit?: number;
        };
        Returns: {
          created_at: string;
          direction: "debit" | "credit";
          amount_kobo: number;
          entry_type: string;
          order_id: string | null;
          order_code: string | null;
          description: string | null;
        }[];
      };
      admin_reset_delivery_code_attempts: {
        Args: {
          p_order_id: string;
          p_actor_id: string;
        };
        Returns: OrderRow;
      };
    };
    Enums: {
      order_status: OrderStatus;
    };
  };
}
