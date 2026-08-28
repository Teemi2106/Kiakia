// app/(customer)/home/page.tsx
import { EmptyState } from "@kiakia/ui";
import { haversineDistanceM, TERMINAL_STATUSES, type OrderStatus } from "@kiakia/domain";
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

  // Category chips are real vendor data (vendors.category, set at onboarding
  // from a fixed list — see app/onboarding/_components/VendorOnboardingForm.tsx)
  // rather than the multi-vertical tabs Chowdeck shows (Restaurants/Shops/
  // Pharmacies) — KiaKia ships food only, so this row is per-cuisine, not
  // per-vertical. Distinct values are derived here since there aren't many
  // vendors yet and PostgREST has no DISTINCT. Scoped to the customer's own
  // state for the same reason the vendor lists below are: a category only
  // available from an out-of-state vendor shouldn't appear as choosable here.
  let categoryQuery = supabase.from("vendors").select("category").eq("status", "active");
  if (customerState) categoryQuery = categoryQuery.ilike("state", customerState);

  // Resolved alongside the category list so the live-order card costs no
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
      { data: categoryRows },
      { data: liveOrderVendor },
      { data: topRated },
      { data: allVendorsRaw },
      { data: dishRows },
    ] = await Promise.all([
      categoryQuery,
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

    const categories = distinctCategories(categoryRows);
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
  const [{ data: categoryRows }, { data: liveOrderVendor }, matchedVendorIds] = await Promise.all([
    categoryQuery,
    liveOrderVendorQuery,
    resolveSearchMatches(supabase, q),
  ]);
  const categories = distinctCategories(categoryRows);

  let vendors: VendorCardVendor[] = [];
  // An empty match set means the search matched nothing at all — skip the
  // query outright rather than passing `.in("id", [])` through to
  // PostgREST, which some clients turn into an always-false-but-still-a-
  // real-query filter; short-circuiting is simpler and avoids relying on
  // that behavior.
  if (!q || (matchedVendorIds && matchedVendorIds.length > 0)) {
    let vendorQuery = supabase.from("vendors").select(VENDOR_COLUMNS).eq("status", "active");
    if (customerState) vendorQuery = vendorQuery.ilike("state", customerState);
    if (matchedVendorIds) vendorQuery = vendorQuery.in("id", matchedVendorIds);
    if (category) vendorQuery = vendorQuery.eq("category", category);
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

  return (
    <HomeShell
      firstName={firstName}
      activeOrder={toActiveOrder(newestLiveOrder, liveOrderVendor?.name ?? null)}
      otherActiveCount={Math.max(liveOrders.length - 1, 0)}
      categories={categories}
      activeCategory={category}
      homeSearchParams={{ q, category, open, quick, sort }}
    >
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
    </HomeShell>
  );
}

/** Distinct, alphabetised vendor categories from a raw `select("category")`. */
function distinctCategories(rows: Array<{ category: string | null }> | null): string[] {
  return Array.from(new Set((rows ?? []).map((row) => row.category).filter(Boolean) as string[])).sort(
    (a, b) => a.localeCompare(b),
  );
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
  categories: string[];
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
