import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseClientMock, type QueryResult } from "@/test/supabase-mock";

const ME = "customer-a";
const OTHER = "customer-b";

const state = { client: { current: supabaseClientMock() } };

vi.mock("@/lib/auth/dal", () => ({
  verifySession: () => Promise.resolve({ userId: ME, email: "a@example.com", phone: null }),
}));
const createClient = vi.fn(() => Promise.resolve(state.client.current));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
// The recommender must run on the USER-scoped client only. If it ever reaches
// for the service-role client, this throws and the "never uses admin" test fails.
const createAdminClient = vi.fn(() => {
  throw new Error("admin client must not be used by the recommender");
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

const { getHomeRecommendations } = await import("./get-home-recommendations");

// ---------------------------------------------------------------------------
// A table fake that APPLIES .eq() filters to its rows when awaited, so a test
// can seed OTHER customers' rows (which RLS lets vendor staff / riders read)
// and prove the DAL's own customer_id filter is what keeps them out.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function table(rows: Row[], opts: { error?: QueryResult["error"] } = {}) {
  const eqCalls: Array<[string, unknown]> = [];
  const calls: Record<string, unknown[][]> = {};
  const builder: Record<string, unknown> = {};
  const record = (name: string) =>
    vi.fn((...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      if (name === "eq") eqCalls.push([args[0] as string, args[1]]);
      return builder;
    });
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "gte", "ilike"]) builder[m] = record(m);
  const resolve = (): QueryResult<Row[]> => {
    if (opts.error) return { data: null, error: opts.error };
    const filtered = rows.filter((r) => eqCalls.every(([col, val]) => !(col in r) || r[col] === val));
    return { data: filtered, error: null };
  };
  builder.maybeSingle = vi.fn(() => {
    const r = resolve();
    return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
  });
  builder.then = (f: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(f, rej);
  return Object.assign(builder, { eqCalls, calls });
}

type Table = ReturnType<typeof table>;

const OPEN_ALL_DAYS = Array.from({ length: 7 }, (_, day) => ({ day, isOpen: true, opensAt: "00:00", closesAt: "23:59" }));
const CLOSED_ALL_DAYS = Array.from({ length: 7 }, (_, day) => ({ day, isOpen: false, opensAt: "08:00", closesAt: "20:00" }));

const HERE = { lat: 6.5244, lng: 3.3792 };

function vendorRow(over: Row = {}): Row {
  return {
    id: "v-near",
    name: "Near Kitchen",
    slug: "near-kitchen",
    avg_prep_mins: 20,
    rating_avg: 4.5,
    rating_count: 40,
    is_accepting_orders: true,
    opening_hours: OPEN_ALL_DAYS,
    state: "Lagos",
    location_lat: HERE.lat,
    location_lng: HERE.lng,
    delivery_radius_m: 5000,
    ...over,
  };
}

function itemRow(id: string, vendorId: string, over: Row = {}): Row {
  return {
    id,
    name: `Dish ${id}`,
    image_url: null,
    price_kobo: 200_000,
    prep_mins: 15,
    vendor_id: vendorId,
    category_id: null,
    is_available: true,
    ...over,
  };
}

interface World {
  addresses?: Row[];
  vendors?: Row[];
  items?: Row[];
  categories?: Row[];
  orders?: Row[];
  orderItems?: Row[];
  ratings?: Row[];
  events?: Row[];
}

function build(world: World, errorOn?: string) {
  const err = (name: string) => (errorOn === name ? { error: { message: "boom" } } : {});
  const tables = {
    addresses: table(
      world.addresses ?? [{ customer_id: ME, state: "Lagos", location_lat: HERE.lat, location_lng: HERE.lng }],
      err("addresses"),
    ),
    vendors: table(world.vendors ?? [vendorRow()], err("vendors")),
    menu_items: table(world.items ?? [itemRow("i1", "v-near")], err("menu_items")),
    menu_categories: table(world.categories ?? [], err("menu_categories")),
    orders: table(world.orders ?? [], err("orders")),
    order_items: table(world.orderItems ?? [], err("order_items")),
    order_ratings: table(world.ratings ?? [], err("order_ratings")),
    customer_events: table(world.events ?? [], err("customer_events")),
  };
  state.client.current = supabaseClientMock({ from: tables as unknown as Record<string, never> });
  return tables as Record<keyof typeof tables, Table>;
}

const NOW = new Date("2026-10-09T18:30:00Z"); // Fri 19:30 Lagos

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const delivered = (id: string, customer: string) => ({
  id,
  customer_id: customer,
  vendor_id: "v-near",
  status: "delivered",
  placed_at: "2026-10-05T12:00:00Z",
  created_at: "2026-10-05T12:00:00Z",
});

describe("getHomeRecommendations - customer scoping (privacy)", () => {
  it("filters orders, ratings, events and the address by the caller's own customer_id", async () => {
    const t = build({});
    await getHomeRecommendations();
    for (const name of ["addresses", "orders", "order_ratings", "customer_events"] as const) {
      expect(t[name].eqCalls, name).toContainEqual(["customer_id", ME]);
    }
  });

  it("regression: another customer's orders/ratings/events (readable by a vendor-owner or rider via RLS) never become the caller's signals", async () => {
    // OTHER ordered "i1" three times, rated it 5, carted it. The caller has no
    // history at all, so the correct answer is cold start.
    const otherOrders = [1, 2, 3].map((n) => delivered(`o-other-${n}`, OTHER));
    const t = build({
      orders: otherOrders,
      orderItems: otherOrders.map((o) => ({ order_id: o.id, menu_item_id: "i1", unit_price_kobo: 200_000 })),
      ratings: otherOrders.map((o) => ({ customer_id: OTHER, order_id: o.id, vendor_rating: 5 })),
      events: [
        {
          customer_id: OTHER,
          event_type: "cart_add",
          vendor_id: "v-near",
          menu_item_id: "i1",
          search_query: null,
          created_at: "2026-10-09T10:00:00Z",
        },
      ],
    });
    const result = await getHomeRecommendations();
    expect(result.personalised).toBe(false);
    expect(result.items.map((i) => i.reasonCode)).toEqual(["top_rated"]);
    // and the DAL never even asked for order_items of another customer's orders
    expect(t.order_items.calls.in ?? []).toEqual([]);
  });

  it("does use the caller's own history (control: the fake is not simply hiding everything)", async () => {
    build({
      orders: [delivered("o-mine", ME)],
      orderItems: [{ order_id: "o-mine", menu_item_id: "i1", unit_price_kobo: 200_000 }],
    });
    const result = await getHomeRecommendations();
    expect(result.personalised).toBe(true);
    expect(result.items[0]).toMatchObject({ menuItemId: "i1", bucket: "familiar" });
  });

  it("never touches the admin (service-role) client, on success or on error paths", async () => {
    build({});
    await getHomeRecommendations();
    build({}, "orders");
    await getHomeRecommendations();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalled();
  });
});

describe("getHomeRecommendations - eligibility is filtered BEFORE ranking", () => {
  it("excludes vendors outside delivery_radius_m when the customer's coordinates are known", async () => {
    build({
      vendors: [
        vendorRow(),
        // ~111 km north with a 5 km radius: place_order() would refuse it.
        vendorRow({ id: "v-far", name: "Far Kitchen", slug: "far-kitchen", location_lat: HERE.lat + 1, delivery_radius_m: 5000 }),
      ],
      items: [itemRow("i1", "v-near"), itemRow("i-far", "v-far")],
    });
    const ids = (await getHomeRecommendations()).items.map((i) => i.menuItemId);
    expect(ids).toEqual(["i1"]);
  });

  it("keeps a vendor whose radius covers the distance, and skips the radius check when the customer has no coordinates", async () => {
    build({
      vendors: [vendorRow({ id: "v-far", slug: "far", location_lat: HERE.lat + 1, delivery_radius_m: 200_000 })],
      items: [itemRow("i-far", "v-far")],
    });
    expect((await getHomeRecommendations()).items.map((i) => i.menuItemId)).toEqual(["i-far"]);

    build({
      addresses: [{ customer_id: ME, state: "Lagos", location_lat: null, location_lng: null }],
      vendors: [vendorRow({ id: "v-far", slug: "far", location_lat: HERE.lat + 1, delivery_radius_m: 5000 })],
      items: [itemRow("i-far", "v-far")],
    });
    expect((await getHomeRecommendations()).items.map((i) => i.menuItemId)).toEqual(["i-far"]);
  });

  it("excludes a vendor that is closed right now (Africa/Lagos time) and includes it when open", async () => {
    // Vendor open 08:00-20:00 on Fridays only.
    const fridayHours = Array.from({ length: 7 }, (_, day) => ({
      day,
      isOpen: day === 5,
      opensAt: "08:00",
      closesAt: "20:00",
    }));
    const vendors = [vendorRow({ opening_hours: fridayHours })];
    const items = [itemRow("i1", "v-near")];

    vi.setSystemTime(new Date("2026-10-09T18:30:00Z")); // Fri 19:30 Lagos: open
    build({ vendors, items });
    expect((await getHomeRecommendations()).items).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-09T19:30:00Z")); // Fri 20:30 Lagos: closed
    build({ vendors, items });
    expect(await getHomeRecommendations()).toEqual({ personalised: false, items: [] });

    vi.setSystemTime(new Date("2026-10-09T23:30:00Z")); // Sat 00:30 Lagos (still Fri in UTC): closed Saturdays
    build({ vendors, items });
    expect((await getHomeRecommendations()).items).toEqual([]);
  });

  it("excludes vendors whose schedule is closed or that are not accepting orders", async () => {
    build({
      vendors: [vendorRow({ opening_hours: CLOSED_ALL_DAYS }), vendorRow({ id: "v-off", slug: "off", is_accepting_orders: false })],
      items: [itemRow("i1", "v-near"), itemRow("i2", "v-off")],
    });
    expect(await getHomeRecommendations()).toEqual({ personalised: false, items: [] });
  });

  it("only queries available items from active vendors, and drops items whose category is inactive", async () => {
    const t = build({
      items: [
        itemRow("i1", "v-near"),
        itemRow("i-cat-off", "v-near", { category_id: "c-off" }),
        itemRow("i-cat-on", "v-near", { category_id: "c-on" }),
      ],
      categories: [
        { id: "c-off", category_key: "drinks", is_active: false },
        { id: "c-on", category_key: "soups", is_active: true },
      ],
    });
    const ids = (await getHomeRecommendations()).items.map((i) => i.menuItemId).sort();
    expect(t.menu_items.eqCalls).toContainEqual(["is_available", true]);
    expect(t.vendors.eqCalls).toContainEqual(["status", "active"]);
    expect(ids).toEqual(["i-cat-on", "i1"]);
  });

  it("scopes the vendor query to the customer's state, with LIKE wildcards escaped", async () => {
    const t = build({ addresses: [{ customer_id: ME, state: "Ogun_%", location_lat: null, location_lng: null }] });
    await getHomeRecommendations();
    expect(t.vendors.calls.ilike).toEqual([["state", "Ogun\\_\\%"]]);
  });

  it("strips PostgREST * wildcards from the state before the ilike", async () => {
    const t = build({ addresses: [{ customer_id: ME, state: "La*gos*", location_lat: null, location_lng: null }] });
    await getHomeRecommendations();
    expect(t.vendors.calls.ilike).toEqual([["state", "Lagos"]]);
  });
});

describe("getHomeRecommendations - fails soft", () => {
  it.each(["addresses", "vendors", "menu_items", "menu_categories", "orders", "order_ratings", "customer_events"])(
    "returns { personalised: false, items: [] } without throwing when the %s query errors",
    async (name) => {
      build({}, name);
      await expect(getHomeRecommendations()).resolves.toEqual({ personalised: false, items: [] });
    },
  );

  it("fails soft when order_items errors", async () => {
    build({ orders: [delivered("o1", ME)] }, "order_items");
    await expect(getHomeRecommendations()).resolves.toEqual({ personalised: false, items: [] });
  });

  it("fails soft when the client cannot be created", async () => {
    createClient.mockImplementationOnce(() => Promise.reject(new Error("cookies unavailable")));
    await expect(getHomeRecommendations()).resolves.toEqual({ personalised: false, items: [] });
  });

  it("returns empty when no vendor is eligible", async () => {
    build({ vendors: [] });
    expect(await getHomeRecommendations()).toEqual({ personalised: false, items: [] });
  });
});
