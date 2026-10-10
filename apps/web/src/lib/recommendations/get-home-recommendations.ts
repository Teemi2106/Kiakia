import "server-only";
import {
  haversineDistanceM,
  rankRecommendations,
  RECOMMENDATION_CONFIG,
  type RecCandidate,
  type RecEvent,
  type RecOrder,
  type RecommendationResult,
} from "@kiakia/domain";
import { isVendorOpenNow } from "@/app/(customer)/home/_lib/opening-hours";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** What the home page renders: see RecommendationResult / RecommendedItem in @kiakia/domain. */
export type HomeRecommendations = RecommendationResult;

const EMPTY: HomeRecommendations = { personalised: false, items: [] };

// Bounds. Everything below is a plain, capped, user-scoped read - no
// PostgREST embeds, two-plain-queries + JS join, like the home page itself.
const MAX_VENDORS = 100;
const MAX_ITEMS = 600;
const MAX_CATEGORIES = 1000;
const MAX_ORDERS = 100; // also bounds the `.in("order_id", ...)` URL length
const MAX_ORDER_ITEMS = 1000;
const MAX_EVENTS = 500;
const MAX_ENRICH_IDS = 100; // distinct non-candidate items resolved to a category

const VENDOR_COLUMNS =
  "id, name, slug, avg_prep_mins, rating_avg, rating_count, is_accepting_orders, opening_hours, state, location_lat, location_lng, delivery_radius_m";

/** Escapes LIKE wildcards so a state name is matched literally (case-insensitively) by ilike. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * The home page's "Recommended for you" row.
 *
 * Privacy design: runs on the USER-SCOPED client only (never the admin
 * client), so the only rows it can ever read are the caller's own
 * orders/ratings/events (RLS) plus the public catalogue. No other
 * customer's data is touched, which is also why a reason can never mention
 * anyone else.
 *
 * Order of operations is FILTER BEFORE RANKING: an item that cannot be
 * ordered right now (vendor inactive / other state / outside its delivery
 * radius / closed, item unavailable, category inactive) is never a
 * candidate, so it can never be recommended. The radius check mirrors
 * place_order() (0077): distance <= vendors.delivery_radius_m.
 *
 * Fails soft: any query error or exception resolves to the empty,
 * non-personalised result - the home page must never throw because of this.
 * (verifySession() is the one exception: it redirects a logged-out caller,
 * exactly like the page that calls this.)
 */
export async function getHomeRecommendations(): Promise<HomeRecommendations> {
  const session = await verifySession();

  try {
    const supabase = await createClient();
    const now = new Date();
    const since = new Date(now.getTime() - RECOMMENDATION_CONFIG.lookbackDays * 86_400_000).toISOString();

    // ---- 1. Where is the customer? (state + coordinates of the default address)
    const { data: address, error: addressError } = await supabase
      .from("addresses")
      .select("state, location_lat, location_lng")
      .eq("customer_id", session.userId)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (addressError) return EMPTY;

    // PostgREST rewrites `*` to `%` in ilike patterns, and escapeLike() does
    // not cover it, so strip it from the user-controlled state first.
    const customerState = address?.state?.replace(/\*/g, "").trim() || null;
    const customerCoords =
      address?.location_lat != null && address?.location_lng != null
        ? { lat: address.location_lat, lng: address.location_lng }
        : null;

    // ---- 2. Candidate vendors: active, same state, within radius, open now.
    let vendorQuery = supabase.from("vendors").select(VENDOR_COLUMNS).eq("status", "active");
    if (customerState) vendorQuery = vendorQuery.ilike("state", escapeLike(customerState));
    const { data: vendorRows, error: vendorError } = await vendorQuery
      .order("rating_avg", { ascending: false })
      .order("id", { ascending: true })
      .limit(MAX_VENDORS);
    if (vendorError) return EMPTY;

    const vendors = new Map<
      string,
      { row: NonNullable<typeof vendorRows>[number]; distanceM: number | null }
    >();
    for (const vendor of vendorRows ?? []) {
      let distanceM: number | null = null;
      if (customerCoords && vendor.location_lat != null && vendor.location_lng != null) {
        distanceM = haversineDistanceM(customerCoords, { lat: vendor.location_lat, lng: vendor.location_lng });
        // Same rule place_order() enforces (0077).
        if (distanceM > vendor.delivery_radius_m) continue;
      }
      if (!isVendorOpenNow(vendor)) continue;
      vendors.set(vendor.id, { row: vendor, distanceM });
    }
    if (vendors.size === 0) return EMPTY;
    const vendorIds = [...vendors.keys()];

    // ---- 3. Their available items + active categories, and the customer's own signals, together.
    const [itemsResult, categoriesResult, ordersResult, ratingsResult, eventsResult] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name, image_url, price_kobo, prep_mins, vendor_id, category_id")
        .in("vendor_id", vendorIds)
        .eq("is_available", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .limit(MAX_ITEMS),
      supabase
        .from("menu_categories")
        .select("id, category_key, is_active")
        .in("vendor_id", vendorIds)
        .limit(MAX_CATEGORIES),
      supabase
        .from("orders")
        .select("id, vendor_id, status, placed_at, created_at")
        .eq("customer_id", session.userId)
        .neq("status", "draft")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_ORDERS),
      supabase
        .from("order_ratings")
        .select("order_id, vendor_rating")
        .eq("customer_id", session.userId)
        .gte("created_at", since)
        .limit(MAX_ORDERS),
      supabase
        .from("customer_events")
        .select("event_type, vendor_id, menu_item_id, search_query, created_at")
        .eq("customer_id", session.userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(MAX_EVENTS),
    ]);
    if (
      itemsResult.error ||
      categoriesResult.error ||
      ordersResult.error ||
      ratingsResult.error ||
      eventsResult.error
    ) {
      return EMPTY;
    }

    const orderRows = ordersResult.data ?? [];
    const orderIds = orderRows.map((o) => o.id);
    const { data: orderItemRows, error: orderItemsError } = orderIds.length
      ? await supabase
          .from("order_items")
          .select("order_id, menu_item_id, unit_price_kobo")
          .in("order_id", orderIds)
          .limit(MAX_ORDER_ITEMS)
      : { data: [], error: null };
    if (orderItemsError) return EMPTY;

    // Category per category id; only ACTIVE categories make an item eligible.
    const categoryKeyById = new Map<string, string>();
    const activeCategoryIds = new Set<string>();
    for (const category of categoriesResult.data ?? []) {
      categoryKeyById.set(category.id, category.category_key);
      if (category.is_active) activeCategoryIds.add(category.id);
    }

    // ---- 4. Candidates: available item + (no category | active category).
    const candidates: RecCandidate[] = [];
    for (const item of itemsResult.data ?? []) {
      const vendor = vendors.get(item.vendor_id);
      if (!vendor) continue;
      if (item.category_id && !activeCategoryIds.has(item.category_id)) continue;
      candidates.push({
        menuItemId: item.id,
        name: item.name,
        vendorId: vendor.row.id,
        vendorName: vendor.row.name,
        vendorSlug: vendor.row.slug,
        categoryKey: item.category_id ? (categoryKeyById.get(item.category_id) ?? null) : null,
        priceKobo: item.price_kobo,
        imageUrl: item.image_url,
        prepMins: item.prep_mins ?? vendor.row.avg_prep_mins,
        distanceM: vendor.distanceM,
        vendorRatingAvg: vendor.row.rating_avg,
        vendorRatingCount: vendor.row.rating_count,
      });
    }
    if (candidates.length === 0) return EMPTY;

    // ---- 5. Category lookup for signal items that are NOT candidates (e.g.
    // ordered from a restaurant that is closed right now), so category
    // similarity still learns from them. Best-effort: a failure only means
    // less category signal, never an error.
    const candidateCategory = new Map(candidates.map((c) => [c.menuItemId, c.categoryKey]));
    const signalItemIds = new Set<string>();
    for (const row of orderItemRows ?? []) signalItemIds.add(row.menu_item_id);
    for (const row of eventsResult.data ?? []) if (row.menu_item_id) signalItemIds.add(row.menu_item_id);
    const unknownItemIds = [...signalItemIds].filter((id) => !candidateCategory.has(id)).slice(0, MAX_ENRICH_IDS);

    const enrichedCategory = new Map<string, string | null>();
    if (unknownItemIds.length > 0) {
      const { data: itemCategoryRows, error: enrichError } = await supabase
        .from("menu_items")
        .select("id, category_id")
        .in("id", unknownItemIds);
      const categoryIds = [...new Set((itemCategoryRows ?? []).map((r) => r.category_id).filter((id): id is string => Boolean(id)))];
      if (!enrichError && categoryIds.length > 0) {
        const { data: categoryRows, error: categoryEnrichError } = await supabase
          .from("menu_categories")
          .select("id, category_key")
          .in("id", categoryIds);
        if (!categoryEnrichError) {
          const keyById = new Map((categoryRows ?? []).map((c) => [c.id, c.category_key]));
          for (const row of itemCategoryRows ?? []) {
            enrichedCategory.set(row.id, row.category_id ? (keyById.get(row.category_id) ?? null) : null);
          }
        }
      }
    }
    const categoryOf = (menuItemId: string): string | null =>
      candidateCategory.get(menuItemId) ?? enrichedCategory.get(menuItemId) ?? null;

    // ---- 6. Shape the customer's own signals for the pure engine.
    const ratingByOrder = new Map((ratingsResult.data ?? []).map((r) => [r.order_id, r.vendor_rating]));
    const itemsByOrder = new Map<string, RecOrder["items"][number][]>();
    for (const row of orderItemRows ?? []) {
      const list = itemsByOrder.get(row.order_id) ?? [];
      list.push({
        menuItemId: row.menu_item_id,
        unitPriceKobo: row.unit_price_kobo,
        categoryKey: categoryOf(row.menu_item_id),
      });
      itemsByOrder.set(row.order_id, list);
    }
    const orders: RecOrder[] = orderRows.map((order) => ({
      vendorId: order.vendor_id,
      status: order.status,
      placedAt: order.placed_at ?? order.created_at,
      items: itemsByOrder.get(order.id) ?? [],
      vendorRating: ratingByOrder.get(order.id) ?? null,
    }));
    const events: RecEvent[] = (eventsResult.data ?? []).map((event) => ({
      eventType: event.event_type,
      vendorId: event.vendor_id,
      menuItemId: event.menu_item_id,
      categoryKey: event.menu_item_id ? categoryOf(event.menu_item_id) : null,
      searchQuery: event.search_query,
      createdAt: event.created_at,
    }));

    return rankRecommendations({ orders, events, candidates, now });
  } catch {
    return EMPTY;
  }
}
