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
  /** Set once, the first time this order is ever dispatched to any rider
   * (early-dispatch or ready_for_pickup, whichever comes first) — the
   * anchor for the 30-minute give-up SLA (0067). Never reset. */
  first_dispatched_at: string | null;
  /** Reset to now() each time dispatch starts a fresh notify-everyone cycle
   * (0067) — sweep_dispatch_offers() excludes a rider from re-offer only
   * for rows offered since this timestamp, not forever, so an exhausted
   * pool loops back to the closest rider again instead of going silent. */
  dispatch_cycle_started_at: string | null;
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
  // Payout destination (0079_rider_bank_details.sql) - all three set or none.
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
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
      // Exactly one of customer_id / vendor_id is set on any given row -
      // enforced by the notifications_one_audience check constraint
      // (0049_vendor_notifications.sql), which TypeScript cannot express
      // here, so both read as nullable.
      notifications: {
        Row: {
          id: string;
          customer_id: string | null;
          vendor_id: string | null;
          order_id: string | null;
          title: string;
          body: string;
          is_read: boolean;
          created_at: string;
        };
        // 0038_customer_notifications.sql:39 revokes insert/delete from both
        // authenticated and anon outright (rows are written only by the two
        // SECURITY DEFINER order-status triggers), so there is no
        // authenticated-reachable insert shape to type here at all - fixed
        // in 0057_rider_review_round_two.sql (task 8), this file was
        // hand-authored and had drifted to permit what SQL denies.
        Insert: never;
        // 0049_vendor_notifications.sql:65-66 revokes table-wide UPDATE and
        // grants back only `update (is_read)` - a recipient can flip
        // is_read on their own row and nothing else. Narrowed here to match,
        // same fix as rider_notifications.Update below - see this file's
        // own 0057 comment there for the full reasoning.
        Update: {
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
          // rating_avg/rating_count (0073_order_ratings.sql) - maintained
          // only by submit_order_rating(), never recomputed from scratch.
          rating_avg: number;
          rating_count: number;
          // Payout destination (0079) - written only by update_rider_bank_details().
          bank_name: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
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
          rating_avg?: number;
          rating_count?: number;
          bank_name?: string | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
        };
        Update: {
          user_id?: string;
          vehicle_type?: string | null;
          plate_number?: string | null;
          kyc_status?: "pending" | "approved" | "rejected";
          is_online?: boolean;
          current_location?: string | null;
          last_ping_at?: string | null;
          rating_avg?: number;
          rating_count?: number;
          bank_name?: string | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
        };
        Relationships: [];
      };
      // order_ratings (0073_order_ratings.sql) - one row per delivered
      // order, written only by submit_order_rating(). No authenticated-
      // reachable insert/update/delete path exists.
      order_ratings: {
        Row: {
          order_id: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          vendor_rating: number;
          vendor_comment: string | null;
          rider_rating: number | null;
          rider_comment: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // customer_events (0084_customer_events.sql) - append-only behavioural
      // signals for the home recommender. Written only by
      // log_customer_event() and the cart_items triggers; customers read
      // only their own rows. No authenticated-reachable write path.
      customer_events: {
        Row: {
          id: string;
          customer_id: string;
          event_type:
            | "view_vendor"
            | "view_item"
            | "search"
            | "cart_add"
            | "cart_remove"
            | "recommendation_click";
          vendor_id: string | null;
          menu_item_id: string | null;
          search_query: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
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
          first_dispatched_at: string | null;
          dispatch_cycle_started_at: string | null;
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
      // admin_audit_log (0080_admin_audit_log.sql) - append-only. service_role
      // may SELECT only; the sole writer is the internal _write_admin_audit(),
      // called from inside each admin RPC in the same transaction.
      admin_audit_log: {
        Row: {
          id: string;
          actor_id: string;
          action: string;
          target_type: "user" | "vendor" | "rider" | "rider_document" | "order" | "service_area" | "export" | "platform_setting" | "message";
          target_id: string;
          reason: string | null;
          details: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // platform_settings (0092_platform_fees.sql) - admin-set platform fees,
      // one row per key. service_role may SELECT only; the sole writer is
      // admin_set_platform_fee(). Keys: service_fee_bps, default_vendor_commission_bps.
      platform_settings: {
        Row: {
          key: string;
          id: string;
          value_int: number;
          unit: "bps" | "kobo";
          updated_at: string;
          updated_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Messaging (0094_messaging_core.sql) - hand-authored. RLS on everywhere.
      // message_preferences: the owner may SELECT own row and UPDATE the two
      // marketing columns; absent row = both false. Writer of record is
      // set_message_preferences(). All other messaging tables: no client access,
      // service_role SELECT only; writes go through the RPCs below.
      message_preferences: {
        Row: {
          user_id: string;
          marketing_email: boolean;
          marketing_sms: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: { marketing_email?: boolean; marketing_sms?: boolean };
        Relationships: [];
      };
      message_consent_events: {
        Row: {
          id: string;
          user_id: string;
          channel: "email" | "sms";
          granted: boolean;
          source: "user" | "unsubscribe_link" | "provider_bounce" | "provider_complaint" | "admin";
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      message_settings: {
        Row: {
          key:
            | "rider_offer_sms_enabled"
            | "rider_offer_sms_delay_seconds"
            | "rider_offer_sms_hourly_cap"
            | "promo_broadcasts_per_day"
            | "transactional_broadcasts_per_day"
            | "direct_messages_per_actor_hour"
            | "broadcast_recipient_cap"
            | "max_send_attempts";
          value_int: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      message_broadcasts: {
        Row: {
          id: string;
          created_by: string;
          channel: "email" | "sms";
          category: "transactional" | "promotional";
          audience: Json;
          audience_label: string;
          subject: string | null;
          body: string;
          recipient_count: number;
          reason: string;
          request_hash: string;
          idempotency_key: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      message_outbox: {
        Row: {
          id: string;
          broadcast_id: string | null;
          kind: "broadcast" | "direct" | "rider_offer" | "system";
          channel: "email" | "sms";
          category: "transactional" | "promotional";
          recipient_user_id: string | null;
          to_address: string | null;
          subject: string | null;
          body: string;
          status: "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";
          suppress_reason: "no_address" | "no_consent" | "suspended" | "expired" | "rate_limited" | "opted_out" | null;
          attempts: number;
          next_attempt_at: string;
          expires_at: string | null;
          provider: string | null;
          provider_message_id: string | null;
          error: string | null;
          dedupe_key: string | null;
          created_by: string | null;
          created_at: string;
          sent_at: string | null;
          delivered_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispatch_offers: {
        Row: {
          id: string;
          order_id: string;
          rider_id: string;
          status: "offered" | "accepted" | "expired" | "declined" | "revoked";
          offered_at: string;
          // expires_at (0028_dispatch_offer_lifecycle.sql) was missing from
          // this hand-authored file entirely until this round (0051) - a
          // real drift this file's own header warns about. Default 60
          // seconds from offered_at; accept_dispatch_offer() refuses an
          // offer once this has passed.
          expires_at: string;
          responded_at: string | null;
        };
        // Written only by dispatch_order_to_nearby_riders() (the
        // ready_for_pickup trigger), accept_dispatch_offer(),
        // decline_dispatch_offer(), and sweep_dispatch_offers() (0055) - no
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
      // rider_documents (0052_rider_kyc_documents.sql) - KYC document
      // metadata; the actual files live in the private `rider-kyc` storage
      // bucket, scoped by storage.objects RLS to each rider's own
      // `<uid>/...` folder. No authenticated-reachable write path exists -
      // every write goes through submit_rider_document() (rider-facing) or
      // approve_rider_document()/reject_rider_document() (admin,
      // service_role only). See that migration's header for why a plain
      // RLS insert policy was deliberately not used here.
      rider_documents: {
        Row: {
          id: string;
          rider_id: string;
          doc_type: "government_id" | "drivers_license" | "vehicle_photo";
          storage_path: string;
          status: "pending" | "approved" | "rejected";
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // rider_push_tokens (0053_rider_push_notifications.sql) - WHERE to
      // send a rider a push notification, not the notification itself.
      // Primary key is (rider_id, token) - see that migration's header for
      // why a surrogate id was deliberately not used. No
      // authenticated-reachable write path exists - writes go through
      // register_rider_push_token()/unregister_rider_push_token().
      rider_push_tokens: {
        Row: {
          rider_id: string;
          token: string;
          platform: "ios" | "android";
          device_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // web_push_subscriptions (0069_web_push_subscriptions.sql) - the
      // customer/vendor-staff counterpart of rider_push_tokens, for the Web
      // Push standard instead of Expo. Written only by
      // register_web_push_subscription()/unregister_web_push_subscription()
      // - no authenticated-reachable insert/update/delete path exists.
      web_push_subscriptions: {
        Row: {
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // rider_notifications (0053_rider_push_notifications.sql) - the
      // rider-side counterpart of `notifications` (0038), keyed on rider_id
      // instead of customer_id. Written only by
      // notify_rider_of_order_status_change() (SECURITY DEFINER trigger) -
      // riders may only flip is_read on their own rows.
      rider_notifications: {
        Row: {
          id: string;
          rider_id: string;
          order_id: string | null;
          title: string;
          body: string;
          is_read: boolean;
          created_at: string;
        };
        // insert/delete have no authenticated-reachable path at all
        // (revoked from both authenticated and anon); update is permitted
        // only for the caller's own rows and, as of
        // 0056_rider_kyc_review_fixes.sql:90-91 (table-wide UPDATE revoked,
        // `grant update (is_read)` given back), only is_read is actually
        // writable - title/body/rider_id/order_id/id all raise
        // "permission denied" on a direct update, no matter what the RLS
        // policy alone would otherwise admit. This type had drifted to
        // permit all five columns; corrected in
        // 0057_rider_review_round_two.sql (task 8) as a types-only fix, no
        // SQL change (0056 already enforced this at the database).
        Insert: never;
        Update: {
          is_read?: boolean;
        };
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
          first_dispatched_at: string | null;
          dispatch_cycle_started_at: string | null;
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
          first_dispatched_at: string | null;
          dispatch_cycle_started_at: string | null;
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
          first_dispatched_at: string | null;
          dispatch_cycle_started_at: string | null;
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
          /** 0080 - audited alongside the action. */
          p_reason?: string;
        };
        Returns: VendorRow;
      };
      reject_vendor: {
        Args: {
          p_vendor_id: string;
          p_actor_id: string;
          /** 0080 - audited alongside the action. */
          p_reason?: string;
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
          status: "offered" | "accepted" | "expired" | "declined" | "revoked";
          offered_at: string;
          expires_at: string;
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
          // rider_name/rider_phone/rider_vehicle_type/rider_plate_number
          // (0071_order_tracking_rider_contact.sql) - NULL until
          // orders.rider_id is set, sourced from profiles + riders.
          rider_name: string | null;
          rider_phone: string | null;
          rider_vehicle_type: string | null;
          rider_plate_number: string | null;
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
          /** 0080 - audited alongside the action. */
          p_reason?: string;
        };
        Returns: RiderRow;
      };
      reject_rider: {
        Args: {
          p_rider_id: string;
          p_actor_id: string;
          /** 0080 - audited alongside the action. */
          p_reason?: string;
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
          /** 0080 - audited alongside the action. */
          p_reason?: string;
        };
        Returns: OrderRow;
      };
      // Admin dispatch override (0083_admin_dispatch_override.sql), both
      // service_role-only. p_rider_id null unassigns and re-offers the order;
      // set, it forces that rider onto it. The reason is required.
      admin_reassign_order_rider: {
        Args: {
          p_order_id: string;
          p_rider_id: string | null;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: OrderRow;
      };
      admin_list_assignable_riders: {
        Args: {
          p_order_id: string;
          p_limit?: number;
        };
        Returns: {
          rider_id: string;
          full_name: string | null;
          phone: string | null;
          pickup_distance_m: number;
          rider_fee_kobo: number;
          last_ping_at: string;
        }[];
      };
      // submit_rider_document (0052_rider_kyc_documents.sql) - the only
      // authenticated-reachable write path for rider_documents. Upserts on
      // (rider_id, doc_type), always resetting status to pending.
      submit_rider_document: {
        Args: {
          p_doc_type: "government_id" | "drivers_license" | "vehicle_photo";
          p_storage_path: string;
        };
        Returns: {
          id: string;
          rider_id: string;
          doc_type: "government_id" | "drivers_license" | "vehicle_photo";
          storage_path: string;
          status: "pending" | "approved" | "rejected";
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      // approve_rider_document / reject_rider_document (0052) - mirrors
      // approve_rider/reject_rider (0027) exactly: SECURITY DEFINER,
      // service_role only, never granted to authenticated.
      approve_rider_document: {
        Args: {
          p_document_id: string;
          p_actor_id: string;
        };
        Returns: {
          id: string;
          rider_id: string;
          doc_type: "government_id" | "drivers_license" | "vehicle_photo";
          storage_path: string;
          status: "pending" | "approved" | "rejected";
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      reject_rider_document: {
        Args: {
          p_document_id: string;
          p_actor_id: string;
          p_note: string;
        };
        Returns: {
          id: string;
          rider_id: string;
          doc_type: "government_id" | "drivers_license" | "vehicle_photo";
          storage_path: string;
          status: "pending" | "approved" | "rejected";
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      // register_rider_push_token / unregister_rider_push_token
      // (0053_rider_push_notifications.sql) - rider_id is always derived
      // from auth.uid() inside the function, never accepted as a
      // parameter, so neither can ever act on another rider's token.
      register_rider_push_token: {
        Args: {
          p_token: string;
          p_platform: "ios" | "android";
          p_device_id?: string | null;
        };
        Returns: {
          rider_id: string;
          token: string;
          platform: "ios" | "android";
          device_id: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      unregister_rider_push_token: {
        Args: {
          p_token: string;
        };
        Returns: undefined;
      };
      // register_web_push_subscription / unregister_web_push_subscription
      // (0069_web_push_subscriptions.sql) - the customer/vendor-staff
      // counterpart of register_rider_push_token(), for the Web Push
      // standard instead of Expo. Both `returns void` in SQL - Returns:
      // undefined, matching unregister_rider_push_token() above.
      // get_vendor_order_customers (0077_input_and_exposure_hardening.sql) - the
      // only way vendor staff can read a customer's name/phone (profiles is
      // own-row-only under RLS); in-flight orders of the caller's own vendor.
      get_vendor_order_customers: {
        Args: {
          p_order_ids: string[];
        };
        Returns: {
          order_id: string;
          customer_name: string | null;
          customer_phone: string | null;
        }[];
      };
      register_web_push_subscription: {
        Args: {
          p_endpoint: string;
          p_p256dh: string;
          p_auth: string;
        };
        Returns: undefined;
      };
      unregister_web_push_subscription: {
        Args: {
          p_endpoint: string;
        };
        Returns: undefined;
      };
      // log_customer_event (0084_customer_events.sql) - client-callable
      // logger for view_vendor / view_item / search / recommendation_click.
      // customer_id is always auth.uid(); cart_* types are trigger-only.
      log_customer_event: {
        Args: {
          p_event_type: "view_vendor" | "view_item" | "search" | "recommendation_click";
          p_vendor_id?: string | null;
          p_menu_item_id?: string | null;
          p_search_query?: string | null;
        };
        Returns: undefined;
      };
      // submit_order_rating (0073_order_ratings.sql) - the only writer of
      // order_ratings + vendors/riders.rating_avg/rating_count. Requires
      // the order to be `delivered` and the caller to be its customer;
      // refuses a second rating for the same order.
      submit_order_rating: {
        Args: {
          p_order_id: string;
          p_vendor_rating: number;
          p_vendor_comment?: string | null;
          p_rider_rating?: number | null;
          p_rider_comment?: string | null;
        };
        Returns: {
          order_id: string;
          customer_id: string;
          vendor_id: string;
          rider_id: string | null;
          vendor_rating: number;
          vendor_comment: string | null;
          rider_rating: number | null;
          rider_comment: string | null;
          created_at: string;
        };
      };
      // get_rider_earnings_history (0054_rider_earnings_history.sql) - the
      // ledger-derived counterpart of get_rider_earnings() (0032): one row
      // per escrow-release credit to the caller's own rider `available`
      // account, never derived from orders.rider_fee_kobo. p_limit is
      // clamped to [1, 100] server-side; p_offset must be >= 0.
      get_rider_earnings_history: {
        Args: {
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          order_id: string;
          order_code: string;
          vendor_name: string;
          amount_kobo: number;
          delivered_at: string | null;
          created_at: string;
        }[];
      };
      // sweep_dispatch_offers (0055_dispatch_offer_sweep.sql) - the
      // re-dispatch sweep 0028_dispatch_offer_lifecycle.sql's own scope
      // note deferred. service_role only; NOT scheduled by any migration -
      // requires pg_cron or an external scheduler calling it with the
      // service-role key roughly every 15-30 seconds. See that migration's
      // header for the exact (commented-out) cron.schedule() statement.
      // Modelled as a plain object rather than `[]`, same convention as
      // get_order_tracking/get_rider_offer_details: it is a `returns table`
      // function that yields exactly one aggregate row (a single `return
      // query select v_expired_count, v_created_count, v_cancelled_count`),
      // so callers use `.single()` and cast. orders_cancelled added by
      // 0067_dispatch_cycle_and_30min_giveup.sql — see that migration for
      // the 30-minute auto-cancel this counts.
      sweep_dispatch_offers: {
        Args: Record<string, never>;
        Returns: {
          offers_expired: number;
          offers_created: number;
          orders_cancelled: number;
        };
      };
      // find_service_area_for_point (0063_service_area_rates_for_point.sql) -
      // read-only, RLS-respecting lookup used to estimate the delivery fee
      // client-side at checkout (useDeliveryFeeEstimate.ts), before
      // place_order() computes the authoritative one. `[]` rather than the
      // single-object convention some other `returns table` functions use
      // here: the caller does not chain `.single()` (zero rows is a normal,
      // expected "outside every service area" outcome, not an error to
      // throw on), so PostgREST's plain array response is what's typed.
      find_service_area_for_point: {
        Args: { p_lng: number; p_lat: number };
        Returns: {
          id: string;
          base_delivery_fee_kobo: number;
          per_km_fee_kobo: number;
        }[];
      };

      // Admin dashboard operations (0081_admin_operations.sql). All
      // service_role only; every write re-verifies p_actor_id and writes an
      // admin_audit_log row in the same transaction.
      admin_set_user_status: {
        Args: {
          p_user_id: string;
          p_status: "active" | "suspended";
          p_reason: string | null;
          p_actor_id: string;
        };
        /**
         * `changed` is false for an idempotent replay; lift the auth ban only when changed and previous_status was "suspended".
         * `sign_in_ban_deferred` is present (true) only when suspending a rider mid-delivery: do not apply the ban yet.
         */
        Returns: {
          status: "active" | "suspended";
          previous_status: "active" | "suspended";
          changed: boolean;
          sign_in_ban_deferred?: boolean;
        };
      };
      /** true when a row changed, false for an idempotent no-op. */
      admin_set_platform_role: {
        Args: {
          p_user_id: string;
          p_role: "admin" | "superadmin" | "rider";
          p_grant: boolean;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: boolean;
      };
      // admin_set_platform_fee (0092) - service_role only, finance tier, audited.
      admin_set_platform_fee: {
        Args: {
          p_key: "service_fee_bps" | "default_vendor_commission_bps";
          p_value: number;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: {
          key: string;
          id: string;
          value_int: number;
          unit: "bps" | "kobo";
          updated_at: string;
          updated_by: string | null;
        };
      };
      // get_service_fee_bps (0092) - the live customer service fee rate (bps).
      get_service_fee_bps: {
        Args: Record<string, never>;
        Returns: number;
      };
      admin_set_vendor_commission: {
        Args: {
          p_vendor_id: string;
          p_commission_bps: number;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: VendorRow;
      };
      admin_update_service_area: {
        Args: {
          p_service_area_id: string;
          p_base_delivery_fee_kobo: number;
          p_per_km_fee_kobo: number;
          p_rider_base_fee_kobo: number;
          p_rider_per_km_fee_kobo: number;
          p_is_active: boolean;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: {
          id: string;
          name: string;
          polygon: string;
          is_active: boolean;
          base_delivery_fee_kobo: number;
          per_km_fee_kobo: number;
          rider_base_fee_kobo: number;
          rider_per_km_fee_kobo: number;
          launched_at: string | null;
          created_at: string;
        };
      };
      admin_record_payout: {
        Args: {
          p_owner_type: "vendor" | "rider";
          p_owner_id: string;
          p_amount_kobo: number;
          p_external_reference: string;
          p_reason: string | null;
          p_actor_id: string;
        };
        Returns: {
          id: string;
          kind: "payment_capture" | "escrow_release" | "payout" | "refund" | "adjustment";
          reference: string;
          order_id: string | null;
          description: string | null;
          created_at: string;
        };
      };
      /** Where the order's <code>-refund ledger transaction credited: "wallet", "gateway", or null if never refunded (0080). */
      order_refund_destination: {
        Args: { p_order_code: string };
        Returns: "wallet" | "gateway" | null;
      };
      /** Returns the order code to hand to requestMonnifyRefundForOrder(). */
      admin_request_gateway_refund: {
        Args: {
          p_order_id: string;
          p_reason: string | null;
          p_actor_id: string;
        };
        Returns: string;
      };
      // jsonb documents - typed in apps/web/src/lib/admin/finance.ts (DashboardMetrics, LedgerHealth).
      admin_dashboard_metrics: {
        Args: Record<string, never>;
        Returns: Json;
      };
      admin_ledger_health: {
        Args: Record<string, never>;
        Returns: Json;
      };
      // jsonb document - typed in apps/web/src/lib/admin/finance.ts (MoneySummary). Hand-typed (0091).
      admin_money_summary: {
        Args: {
          p_from?: string | null;
          p_to?: string | null;
        };
        Returns: Json;
      };
      admin_list_balances: {
        Args: {
          p_owner_type: "vendor" | "rider" | "customer";
          p_limit?: number;
          p_offset?: number;
          p_owner_id?: string;
        };
        Returns: {
          owner_id: string;
          display_name: string | null;
          balance_kobo: number;
          disbursed_kobo: number;
          bank_name: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          total_count: number;
        }[];
      };
      // customer_bootstrap (0089_customer_read_performance.sql) - hand-authored.
      // SECURITY INVOKER read, authenticated only. cart is null when the caller has no open cart.
      customer_bootstrap: {
        Args: Record<string, never>;
        Returns: {
          cart: {
            id: string;
            vendor_id: string | null;
            vendor_name: string | null;
            items: {
              id: string;
              menu_item_id: string;
              menu_item_image_url: string | null;
              name_snapshot: string;
              unit_price_kobo: number;
              qty: number;
              options_snapshot: Json;
              line_total_kobo: number;
            }[];
          } | null;
          unread_notifications: number;
          default_address: { label: string | null; line1: string } | null;
        };
      };
      // admin_list_users (0087_admin_read_scalability.sql) - hand-authored.
      admin_list_users: {
        Args: {
          p_q?: string | null;
          p_status?: "active" | "suspended" | "deleted" | null;
          p_role?: "rider" | "vendor_staff" | "vendor_manager" | "vendor_owner" | "admin" | "superadmin" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          full_name: string | null;
          phone: string | null;
          status: "active" | "suspended" | "deleted";
          created_at: string;
          roles: Role[];
          total_count: number;
        }[];
      };
      // admin_list_customers / admin_list_riders / admin_rider_state_counts / admin_list_payables (0090_admin_directory_and_payables.sql) - hand-authored.
      admin_list_customers: {
        Args: {
          p_q?: string | null;
          p_status?: "active" | "suspended" | "deleted" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          full_name: string | null;
          phone: string | null;
          status: "active" | "suspended" | "deleted";
          created_at: string;
          order_count: number;
          wallet_balance_kobo: number;
          total_count: number;
        }[];
      };
      admin_list_riders: {
        Args: {
          p_q?: string | null;
          p_state?: "pending" | "active" | "rejected" | "suspended" | "deleted" | null;
          p_availability?: "online" | "offline" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          user_id: string;
          full_name: string | null;
          phone: string | null;
          vehicle_type: string | null;
          plate_number: string | null;
          kyc_status: "pending" | "approved" | "rejected";
          state: "pending" | "active" | "rejected" | "suspended" | "deleted";
          is_online: boolean;
          rating_avg: number;
          rating_count: number;
          last_ping_at: string | null;
          documents_pending: number;
          created_at: string;
          total_count: number;
        }[];
      };
      admin_rider_state_counts: {
        Args: Record<PropertyKey, never>;
        Returns: { state: "pending" | "active" | "rejected" | "suspended" | "deleted"; total: number }[];
      };
      admin_list_payables: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          owner_type: "vendor" | "rider";
          owner_id: string;
          display_name: string | null;
          balance_kobo: number;
          disbursed_kobo: number;
          bank_name: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          total_count: number;
          total_owed_kobo: number;
        }[];
      };
      // admin_log_export / admin_export_orders_page / admin_export_ledger_page (0088_admin_exports.sql) - hand-authored.
      admin_log_export: {
        Args: {
          p_actor_id: string;
          p_kind: "orders" | "ledger";
          p_filters: Json;
        };
        /** The new admin_audit_log.target_id for this export. */
        Returns: string;
      };
      admin_export_orders_page: {
        Args: {
          p_actor_id: string;
          p_from: string;
          p_to: string;
          p_status?: OrderStatus | null;
          p_vendor_id?: string | null;
          p_after_created_at?: string | null;
          p_after_id?: string | null;
          p_limit?: number;
        };
        Returns: {
          id: string;
          code: string;
          created_at: string;
          status: OrderStatus;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          vendor_id: string;
          vendor_name: string;
          customer_id: string;
          rider_id: string | null;
          subtotal_kobo: number;
          delivery_fee_kobo: number;
          service_fee_kobo: number;
          discount_kobo: number;
          total_kobo: number;
          placed_at: string | null;
          delivered_at: string | null;
        }[];
      };
      admin_export_ledger_page: {
        Args: {
          p_actor_id: string;
          p_from: string;
          p_to: string;
          p_after_created_at?: string | null;
          p_after_id?: string | null;
          p_limit?: number;
        };
        Returns: {
          id: string;
          created_at: string;
          transaction_id: string;
          transaction_reference: string;
          transaction_kind: string;
          entry_type: string;
          account_owner_type: string;
          account_kind: string;
          account_owner_id: string | null;
          direction: "debit" | "credit";
          amount_kobo: number;
          order_code: string | null;
        }[];
      };
      // --- Messaging RPCs (0094 / 0095 / 0096) - hand-authored. ---
      // Audience shape (strict; unknown keys rejected):
      //   {kind:"role", role:"customer", segment?: "all"|"ordered_30d"|"inactive_30d"}
      //   {kind:"role", role:"vendor",   segment?: "all"|"active"|"pending"|"suspended"}
      //   {kind:"role", role:"rider",    segment?: "all"|"active"|"pending"|"online"}
      //   {kind:"user", user_id: uuid}
      set_message_preferences: {
        Args: { p_marketing_email?: boolean | null; p_marketing_sms?: boolean | null };
        Returns: { user_id: string; marketing_email: boolean; marketing_sms: boolean; updated_at: string };
      };
      get_message_preferences: {
        Args: Record<string, never>;
        Returns: { marketing_email: boolean; marketing_sms: boolean }[];
      };
      message_opt_out: {
        Args: { p_user_id: string; p_channel: "email" | "sms"; p_source?: "unsubscribe_link" | "provider_bounce" | "provider_complaint" | "admin" };
        Returns: boolean;
      };
      admin_audience_preview: {
        Args: { p_audience: Json; p_channel: "email" | "sms"; p_category: "transactional" | "promotional" };
        Returns: {
          recipient_count: number;
          suppressed_count: number;
          suppressed_reasons: { no_address: number; no_consent: number; suspended: number };
          sample: { user_id: string; display_name: string; role: "customer" | "vendor" | "rider" | "admin" }[];
        };
      };
      admin_create_broadcast: {
        Args: {
          p_actor_id: string;
          p_audience: Json;
          p_channel: "email" | "sms";
          p_category: "transactional" | "promotional";
          p_subject: string | null;
          p_body: string;
          p_reason: string;
          p_idempotency_key?: string | null;
        };
        Returns: string;
      };
      admin_send_message: {
        Args: {
          p_actor_id: string;
          p_user_id: string;
          p_channel: "email" | "sms";
          p_subject: string | null;
          p_body: string;
          p_reason: string;
        };
        Returns: string;
      };
      admin_list_broadcasts: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          created_at: string;
          created_by_name: string;
          channel: "email" | "sms";
          category: "transactional" | "promotional";
          audience_label: string;
          subject: string | null;
          body: string;
          recipient_count: number;
          queued: number;
          sent: number;
          delivered: number;
          failed: number;
          suppressed: number;
          total_count: number;
        }[];
      };
      admin_get_broadcast: {
        Args: { p_id: string };
        Returns: {
          id: string;
          created_at: string;
          created_by: string;
          created_by_name: string;
          channel: "email" | "sms";
          category: "transactional" | "promotional";
          audience: Json;
          audience_label: string;
          subject: string | null;
          body: string;
          reason: string;
          recipient_count: number;
          counts: {
            queued: number;
            sent: number;
            delivered: number;
            failed: number;
            suppressed: number;
            suppressed_reasons: { no_address: number; no_consent: number; suspended: number };
          };
          failures: { user_id: string | null; display_name: string; error: string | null; attempts: number }[];
        };
      };
      admin_list_user_messages: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: {
          id: string;
          created_at: string;
          channel: "email" | "sms";
          category: "transactional" | "promotional";
          kind: "broadcast" | "direct" | "rider_offer" | "system";
          subject: string | null;
          body: string;
          status: "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";
          suppress_reason: "no_address" | "no_consent" | "suspended" | "expired" | "rate_limited" | "opted_out" | null;
          error: string | null;
          sent_at: string | null;
          delivered_at: string | null;
          broadcast_id: string | null;
        }[];
      };
      // Worker / webhook / cron functions (service_role only).
      message_claim_batch: {
        Args: { p_limit?: number };
        Returns: Database["public"]["Tables"]["message_outbox"]["Row"][];
      };
      message_mark_sent: {
        Args: { p_id: string; p_provider: string; p_provider_message_id: string };
        Returns: boolean;
      };
      message_mark_failed: {
        Args: { p_id: string; p_error: string; p_permanent?: boolean };
        Returns: "queued" | "failed" | "suppressed" | "ignored";
      };
      message_mark_suppressed: {
        Args: { p_id: string; p_reason: "no_address" | "no_consent" | "suspended" | "expired" | "opted_out" };
        Returns: boolean;
      };
      message_apply_provider_event: {
        Args: {
          p_provider: string;
          p_provider_message_id: string | null;
          p_outbox_id: string | null;
          p_event: "delivered" | "failed" | "bounced" | "complained";
          p_detail?: string | null;
        };
        Returns: "applied" | "ignored" | "not_found";
      };
      scrub_message_outbox: { Args: Record<string, never>; Returns: number };
      enqueue_rider_offer_sms: { Args: Record<string, never>; Returns: number };
    };
    Enums: {
      order_status: OrderStatus;
    };
  };
}
