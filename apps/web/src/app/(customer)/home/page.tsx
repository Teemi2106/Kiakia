// app/(customer)/home/page.tsx
import { EmptyState } from "@kiakia/ui";
import { haversineDistanceM, MEAL_CATEGORIES, TERMINAL_STATUSES, type MealCategoryPreset, type OrderStatus } from "@kiakia/domain";
import { Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ActiveOrderCard, type ActiveOrder } from "./_components/ActiveOrderCard";
import { CategoryChips } from "./_components/CategoryChips";
import { FeaturedCarousel, type FeaturedVendor } from "./_components/FeaturedCarousel";
import { FilterChips, type HomeSearchParams } from "./_components/FilterChips";
import { HomeGreeting } from "./_components/HomeGreeting";
import { SectionHeading } from "./_components/SectionHeading";
import { VendorCard, type VendorCardVendor } from "./_components/VendorCard";
import { isVendorOpenNow } from "./_lib/opening-hours";

export const metadata: Metadata = { title: "Home" };

const VENDOR_COLUMNS =
  "id, name, slug, category, avg_prep_mins, rating_avg, rating_count, banner_url, is_accepting_orders, opening_hours, state, location_lat, location_lng";

// Same set the /orders page filters on, taken from the state machine itself
// rather than re-listed here — the two must never drift.
const TERMINAL_STATUS_LIST = Array.from(TERMINAL_STATUSES).join(",");

/** Attaches distanceM (customer -> vendor) to each row when the customer's own
 * coordinates are known, then sorts nearest-first — falls back to leaving the
 * given order untouched (e.g. rating/name) when either side's coordinates are
 * missing, rather than fabricating a distance or an arbitrary order. */
function withDistanceSorted<T extends VendorCardVendor>(
  vendors: T[],
  customer: { lat: number; lng: number } | null,
): T[] {
  if (!customer) return vendors;

  const withDistance = vendors.map((v) => ({
    ...v,
    distanceM:
      v.location_lat != null && v.location_lng != null
        ? haversineDistanceM(customer, { lat: v.location_lat, lng: v.location_lng })
        : null,
  }));

  return withDistance.sort((a, b) => {
    if (a.distanceM == null && b.distanceM == null) return 0;
    if (a.distanceM == null) return 1; // unknown-location vendors sort last, never first
    if (b.distanceM == null) return -1;
    return a.distanceM - b.distanceM;
  });
}

/** "Timi Adeyemi" -> "Timi". Empty/whitespace names give null so the greeting
 * falls back to the un-named form rather than rendering a stray comma. */
function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || null;
}

export default async function CustomerHomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const { q, category, open, quick, sort } = await searchParams;
  const session = await verifySession();
  const supabase = await createClient();

  // Everything that depends on nothing but the session goes out together.
  // The customer's own state/coordinates come from their default (or first)
  // saved address — the same "deliver to" address the top nav shows
  // (CustomerTopNav.tsx's useDefaultAddressLabel). Vendors outside this state
  // are excluded outright below, and the rest are ordered nearest-first by
  // these coordinates. A customer with no saved address yet has no basis to
  // filter/sort on — every vendor still shows, unfiltered, rather than an
  // empty page.
  const [{ data: customerAddress }, { data: profile }, { data: activeOrderRows }] =
    await Promise.all([
      supabase
        .from("addresses")
        .select("state, location_lat, location_lng")
        .eq("customer_id", session.userId)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("profiles").select("full_name").eq("id", session.userId).maybeSingle(),
      // Live orders, newest first. Capped because only the newest is shown in
      // full — the rest are a count linking to /orders.
      supabase
        .from("orders")
        .select("id, code, status, total_kobo, vendor_id")
        .eq("customer_id", session.userId)
        .not("status", "in", `(${TERMINAL_STATUS_LIST})`)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const customerState = customerAddress?.state?.trim() || null;
  const customerCoords =
    customerAddress?.location_lat != null && customerAddress?.location_lng != null
      ? { lat: customerAddress.location_lat, lng: customerAddress.location_lng }
      : null;
  const firstName = firstNameOf(profile?.full_name);

  const liveOrders = activeOrderRows ?? [];
  const newestLiveOrder = liveOrders[0] ?? null;

  // Category chips are the same fixed preset list menu items are grouped
  // under (MEAL_CATEGORIES — see packages/domain/src/meal-categories.ts),
  // not vendors.category (each vendor's own single self-declared cuisine
  // tag, still shown on their card/sidebar but no longer what Browse
  // filters by). A vendor's cuisine tag and what's actually on their menu
  // can disagree — an "African" vendor might still sell banana bread — so
  // filtering by what customers can actually order here is what matches
  // "Bakery" to that vendor, not their unrelated cuisine label. Always the
  // full list, not just categories with a match in the customer's state —
  // an empty category is still worth showing as a browsable filter (it
  // just yields an honest "nothing here yet" result).
  const categories = MEAL_CATEGORIES;

  // Left as a promise (not awaited here) so it's batched into the
  // Promise.all() calls below alongside the vendor queries, costing no
  // extra round trip.
  const liveOrderVendorQuery = newestLiveOrder
    ? supabase.from("vendors").select("name").eq("id", newestLiveOrder.vendor_id).maybeSingle()
    : Promise.resolve({ data: null });

  const isFiltered = Boolean(q || category || open === "1" || quick === "1" || sort === "rating");

  // Default browse state: a "Top rated" strip plus the full vendor list,
  // honestly labeled — neither is editorially curated, "Top rated" is a
  // straight rating_avg sort and "All vendors" is nearest-first.
  if (!isFiltered) {
    let topRatedQuery = supabase
      .from("vendors")
      .select(VENDOR_COLUMNS)
      .eq("status", "active")
      .gt("rating_count", 0);
    let allVendorsQuery = supabase.from("vendors").select(VENDOR_COLUMNS).eq("status", "active");
    if (customerState) {
      topRatedQuery = topRatedQuery.ilike("state", customerState);
      allVendorsQuery = allVendorsQuery.ilike("state", customerState);
    }
    topRatedQuery = topRatedQuery
      .order("rating_avg", { ascending: false })
      .order("rating_count", { ascending: false })
      .limit(8);
    // Ordered by name here only as the query's own tiebreaker/pre-sort — the
    // real customer-facing order (nearest first) is applied below by
    // withDistanceSorted() once results are back.
    allVendorsQuery = allVendorsQuery.order("name", { ascending: true }).limit(30);

    const [
      { data: liveOrderVendor },
      { data: topRated },
      { data: allVendorsRaw },
      { data: dishRows },
    ] = await Promise.all([
      liveOrderVendorQuery,
      topRatedQuery,
      allVendorsQuery,
      // A wide, unordered pool of real menu-item photos — deduped to one
      // per vendor below, then cross-checked against real active vendors.
      // No FK embed here (menu_items -> vendors), matching this codebase's
      // established pattern of two plain queries + a JS join rather than
      // a PostgREST embed, e.g. the vendor settings staff list.
      supabase
        .from("menu_items")
        .select("id, name, image_url, vendor_id")
        .eq("is_available", true)
        .not("image_url", "is", null)
        .limit(60),
    ]);

    const topRatedVendors = (topRated ?? []) as VendorCardVendor[];
    const topRatedIds = new Set(topRatedVendors.map((v) => v.id));
    const allVendors = withDistanceSorted(
      ((allVendorsRaw ?? []) as VendorCardVendor[]).filter((v) => !topRatedIds.has(v.id)),
      customerCoords,
    );
    const hasAnyVendors = topRatedVendors.length > 0 || allVendors.length > 0;

    const vendorById = new Map<string, VendorCardVendor>(
      [...topRatedVendors, ...allVendors].map((v) => [v.id, v]),
    );
    const featuredVendorIds = new Set<string>();
    const featured: FeaturedVendor[] = [];
    for (const dish of dishRows ?? []) {
      if (!dish.image_url || !dish.vendor_id || featuredVendorIds.has(dish.vendor_id)) continue;
      const vendor = vendorById.get(dish.vendor_id);
      if (!vendor) continue; // not in the active/top-rated pool fetched above
      featuredVendorIds.add(dish.vendor_id);
      featured.push({ vendor, dishName: dish.name, dishImageUrl: dish.image_url });
      if (featured.length >= 10) break;
    }

    return (
      <HomeShell
        firstName={firstName}
        activeOrder={toActiveOrder(newestLiveOrder, liveOrderVendor?.name ?? null)}
        otherActiveCount={Math.max(liveOrders.length - 1, 0)}
        categories={categories}
        activeCategory={category}
        homeSearchParams={{ q, category, open, quick, sort }}
      >
        {!hasAnyVendors ? (
          <EmptyState
            className="border-kk-line/70 bg-white/70 py-14"
            title="No kitchens open to you yet"
            description="Vendors are still coming on board in your area. Add or update your delivery address if you've moved — the list is scoped to where you're delivering."
            action={
              <Link
                href="/profile/addresses"
                className="font-inter text-sm font-semibold text-kk-red hover:underline"
              >
                Check your address
              </Link>
            }
          />
        ) : (
          <div className="space-y-12">
            {featured.length > 0 && (
              <section>
                <SectionHeading
                  title="Featured dishes"
                  hint="Real photos from vendors' own menus."
                />
                <FeaturedCarousel items={featured} />
              </section>
            )}

            {topRatedVendors.length > 0 && (
              <section>
                <SectionHeading
                  title="Top rated"
                  count={topRatedVendors.length}
                  hint="Sorted by customer rating — not a paid placement."
                />
                <VendorGrid vendors={topRatedVendors} />
              </section>
            )}

            {allVendors.length > 0 && (
              <section>
                <SectionHeading
                  title="All vendors"
                  count={allVendors.length}
                  hint={
                    customerCoords
                      ? "Nearest to your delivery address first."
                      : "Add a delivery address to sort these by distance."
                  }
                />
                <VendorGrid vendors={allVendors} />
              </section>
            )}
          </div>
        )}
      </HomeShell>
    );
  }

  // Filtered/search/chip state: one flat, honestly-labeled result list.
  // A search matches either the vendor's own name OR one of its menu item
  // names — "jollof" should surface every vendor that sells jollof, not
  // just a vendor literally named "Jollof". No FK embed (menu_items ->
  // vendors) for this, same reasoning as the Featured carousel above: two
  // plain queries + a JS-side id union, matching this codebase's
  // established pattern instead of a PostgREST embed.
  const [{ data: liveOrderVendor }, matchedVendorIds, categoryMatch] = await Promise.all([
    liveOrderVendorQuery,
    resolveSearchMatches(supabase, q),
    resolveCategoryMatches(supabase, category),
  ]);
  // Both resolvers return null when their own filter isn't active, so this
  // collapses to "whichever one filter is active" unless both are — in
  // which case a vendor must satisfy both (search AND category).
  const idFilter = intersectOrSingle(matchedVendorIds, categoryMatch?.vendorIds ?? null);

  let vendors: VendorCardVendor[] = [];
  // A non-null-but-empty idFilter means an active filter matched nothing —
  // skip the query outright rather than passing `.in("id", [])` through to
  // PostgREST, which some clients turn into an always-false-but-still-a-
  // real-query filter; short-circuiting is simpler and avoids relying on
  // that behavior.
  if (!idFilter || idFilter.length > 0) {
    let vendorQuery = supabase.from("vendors").select(VENDOR_COLUMNS).eq("status", "active");
    if (customerState) vendorQuery = vendorQuery.ilike("state", customerState);
    if (idFilter) vendorQuery = vendorQuery.in("id", idFilter);
    if (quick === "1") vendorQuery = vendorQuery.lte("avg_prep_mins", 30);
    // Ordered by rating when explicitly asked for; otherwise by name here as
    // just the query's own tiebreaker/pre-sort — nearest-first (below, via
    // withDistanceSorted()) is the real default customer-facing order.
    vendorQuery =
      sort === "rating"
        ? vendorQuery
            .order("rating_avg", { ascending: false })
            .order("rating_count", { ascending: false })
        : vendorQuery.order("name", { ascending: true });
    // "Open now" can't be expressed as a single PostgREST filter (it depends
    // on the current day/time against a jsonb schedule), so fetch a larger
    // pool and filter in JS, then cap to the same page size as the default view.
    vendorQuery = vendorQuery.limit(open === "1" ? 100 : 30);

    const { data: vendorRows } = await vendorQuery;
    vendors = (vendorRows ?? []) as VendorCardVendor[];
    if (open === "1") vendors = vendors.filter(isVendorOpenNow);
    if (sort !== "rating") vendors = withDistanceSorted(vendors, customerCoords);
    vendors = vendors.slice(0, 30);
  }

  // The actual dishes behind a category chip, not just which vendors carry
  // them — capped, and only from vendors that survived every other active
  // filter (quick/open/sort), since a dish from a vendor no longer in
  // `vendors` above would be a dead link disguised as a result.
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const categoryDishes: FeaturedVendor[] = [];
  if (categoryMatch) {
    for (const dish of categoryMatch.dishes) {
      const vendor = vendorById.get(dish.vendorId);
      if (!vendor) continue;
      categoryDishes.push({ vendor, dishName: dish.name, dishImageUrl: dish.imageUrl });
      if (categoryDishes.length >= 24) break;
    }
  }

  return (
    <HomeShell
      firstName={firstName}
      activeOrder={toActiveOrder(newestLiveOrder, liveOrderVendor?.name ?? null)}
      otherActiveCount={Math.max(liveOrders.length - 1, 0)}
      categories={categories}
      activeCategory={category}
      homeSearchParams={{ q, category, open, quick, sort }}
    >
      <div className="space-y-12">
        {categoryDishes.length > 0 && (
          <section>
            <SectionHeading
              title="Dishes"
              count={categoryDishes.length}
              hint="Real photos from vendors' own menus."
            />
            <FeaturedCarousel items={categoryDishes} />
          </section>
        )}

        <section>
          <SectionHeading
            title={q ? `Results for “${q}”` : "Filtered vendors"}
            count={vendors.length}
            hint={
              sort === "rating" ? "Highest rated first." : "Nearest to your delivery address first."
            }
            action={
              <Link
                href="/home"
                className="inline-flex items-center gap-1.5 rounded-full border border-kk-line/70 bg-white px-3.5 py-2 font-inter text-xs font-semibold text-kk-cocoa transition-colors hover:border-kk-red/40 hover:text-kk-red"
              >
                Clear filters
              </Link>
            }
          />

          {vendors.length === 0 ? (
            <EmptyState
              className="border-kk-line/70 bg-white/70 py-14"
              title="Nothing matched that"
              description={`No vendors match your filters${q ? ` for “${q}”` : ""}. Try a different search, or drop a filter or two.`}
              action={
                <Link
                  href="/home"
                  className="font-inter text-sm font-semibold text-kk-red hover:underline"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <VendorGrid vendors={vendors} />
          )}
        </section>
      </div>
    </HomeShell>
  );
}

interface CategoryDish {
  readonly vendorId: string;
  readonly name: string;
  readonly imageUrl: string;
}

interface CategoryMatch {
  /** Every vendor with at least one available item in this category, used
   * to narrow the vendor list. */
  readonly vendorIds: string[];
  /** The subset of those items that have a photo — enough to actually show
   * "the foods", not just which vendors carry them. */
  readonly dishes: readonly CategoryDish[];
}

/** Null when no category filter is active — different from "matched
 * nothing" (vendorIds: []). Two plain queries + a JS-side join
 * (menu_categories -> menu_items), matching this codebase's established
 * pattern (see resolveSearchMatches below) rather than a PostgREST embed.
 * Deliberately item-driven, not vendors.category — see this file's
 * `categories` comment for why. */
async function resolveCategoryMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryKey: string | undefined,
): Promise<CategoryMatch | null> {
  if (!categoryKey) return null;

  const { data: categoryRows } = await supabase
    .from("menu_categories")
    .select("id")
    .eq("category_key", categoryKey)
    .eq("is_active", true);

  const categoryIds = (categoryRows ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return { vendorIds: [], dishes: [] };

  const { data: itemRows } = await supabase
    .from("menu_items")
    .select("vendor_id, name, image_url")
    .in("category_id", categoryIds)
    .eq("is_available", true);

  const rows = itemRows ?? [];
  return {
    vendorIds: Array.from(new Set(rows.map((r) => r.vendor_id))),
    dishes: rows
      .filter((r): r is typeof r & { image_url: string } => Boolean(r.image_url))
      .map((r) => ({ vendorId: r.vendor_id, name: r.name, imageUrl: r.image_url })),
  };
}

/** Combines two optional id filters into one: both non-null means a vendor
 * must satisfy both (intersection); either alone passes through unchanged;
 * neither active gives null (no filter at all). */
function intersectOrSingle(a: string[] | null, b: string[] | null): string[] | null {
  if (a && b) {
    const bSet = new Set(b);
    return a.filter((id) => bSet.has(id));
  }
  return a ?? b;
}

/** Vendor ids whose own name, or one of whose menu items, matches `q`. Null
 * when there is no search term at all — which is different from "matched
 * nothing", the empty array. */
async function resolveSearchMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  q: string | undefined,
): Promise<string[] | null> {
  if (!q) return null;

  const [{ data: nameMatches }, { data: dishMatches }] = await Promise.all([
    supabase.from("vendors").select("id").eq("status", "active").ilike("name", `%${q}%`),
    supabase
      .from("menu_items")
      .select("vendor_id")
      .eq("is_available", true)
      .ilike("name", `%${q}%`),
  ]);

  return Array.from(
    new Set<string>([
      ...(nameMatches ?? []).map((v) => v.id),
      ...(dishMatches ?? []).map((m) => m.vendor_id).filter((id): id is string => Boolean(id)),
    ]),
  );
}

function toActiveOrder(
  row: { id: string; code: string; status: string; total_kobo: number } | null,
  vendorName: string | null,
): ActiveOrder | null {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    status: row.status as OrderStatus,
    total_kobo: row.total_kobo,
    vendorName,
  };
}

function VendorGrid({ vendors }: { vendors: VendorCardVendor[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {vendors.map((vendor) => (
        <VendorCard key={vendor.id} vendor={vendor} />
      ))}
    </div>
  );
}

function HomeShell({
  firstName,
  activeOrder,
  otherActiveCount,
  categories,
  activeCategory,
  homeSearchParams,
  children,
}: {
  firstName: string | null;
  activeOrder: ActiveOrder | null;
  otherActiveCount: number;
  categories: readonly MealCategoryPreset[];
  activeCategory?: string;
  homeSearchParams: HomeSearchParams;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-6 sm:pb-16 sm:pt-8">
      <HomeGreeting firstName={firstName} />

      {activeOrder && (
        <div className="mt-4">
          <ActiveOrderCard order={activeOrder} otherActiveCount={otherActiveCount} />
        </div>
      )}

      {/* Browse controls. Grouped into one panel so the category rail and the
          filter chips read as a single toolbar rather than two loose rows. */}
      <div className="mt-9 space-y-4">
        <div className="flex items-center gap-3">
          <Store className="size-4 shrink-0 text-kk-red" />
          <h2 className="font-inter text-[11px] font-semibold uppercase tracking-[0.22em] text-kk-cocoa">
            Browse
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-kk-line/70" />
        </div>
        <CategoryChips
          categories={categories}
          activeCategory={activeCategory}
          preserveParams={{
            q: homeSearchParams.q,
            open: homeSearchParams.open,
            quick: homeSearchParams.quick,
            sort: homeSearchParams.sort,
          }}
        />
        <FilterChips searchParams={homeSearchParams} />
      </div>

      <div id="vendor-results" className="mt-10 scroll-mt-40 lg:scroll-mt-24">
        {children}
      </div>
    </div>
  );
}
