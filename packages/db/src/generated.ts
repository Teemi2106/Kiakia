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
  payment_method: "card" | "bank_transfer" | "ussd" | null;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  promo_code: string | null;
  delivery_address: Json;
  delivery_location: string;
  delivery_note: string | null;
  distance_m: number | null;
  delivery_code: string | null;
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
  location: string | null;
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
          location: string | null;
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
          location?: string | null;
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
          location?: string | null;
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
          name: string;
          sort_order: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          name: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          name?: string;
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
          payment_method: "card" | "bank_transfer" | "ussd" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
  delivery_code: string | null;
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
          payment_method?: "card" | "bank_transfer" | "ussd" | null;
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
          owner_type: "platform" | "vendor" | "rider";
          owner_id: string | null;
          kind: "escrow" | "available" | "pending_payout" | "revenue" | "gateway";
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
          created_at: string;
        };
        // The only ledger-adjacent table inserted directly via the JS admin
        // client rather than exclusively inside a SQL function: the
        // Server Action that places an order records the 'pending' row
        // right after Monnify's init-transaction call succeeds. Everything
        // downstream (marking it 'success', opening the ledger transaction)
        // happens inside capture_payment() in raw SQL, which is why Update
        // stays `never` here — no JS code path ever updates this row.
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
        };
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
          payment_method: "card" | "bank_transfer" | "ussd" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
  delivery_code: string | null;
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
          payment_method: "card" | "bank_transfer" | "ussd" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
  delivery_code: string | null;
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
          location: string | null;
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
          payment_method: "card" | "bank_transfer" | "ussd" | null;
          payment_status: "pending" | "paid" | "failed" | "refunded";
          promo_code: string | null;
          delivery_address: Json;
          delivery_location: string;
          delivery_note: string | null;
          distance_m: number | null;
  delivery_code: string | null;
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
    };
    Enums: {
      order_status: OrderStatus;
    };
  };
}
