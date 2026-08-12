// app/(auth)/customer/home/page.tsx
import { Badge, Card, cn } from "@kiakia/ui";
import { Star, Utensils, Coffee, Beef, Fish, Pizza, Salad } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home" };

const CATEGORIES = [
  "Jollof",
  "Soups",
  "Swallow",
  "Grills",
  "Sides",
  "Drinks",
] as const;

// Category icons for mobile
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Jollof: <Utensils className="size-5 text-[#B61913]" />,
  Soups: <Coffee className="size-5 text-[#934B00]" />,
  Swallow: <Beef className="size-5 text-[#176A22]" />,
  Grills: <Fish className="size-5 text-[#B61913]" />,
  Sides: <Pizza className="size-5 text-[#934B00]" />,
  Drinks: <Salad className="size-5 text-[#B61913]" />,
};

// Dummy vendors for development/testing
const DUMMY_VENDORS = [
  {
    id: "1",
    name: "The Place",
    slug: "the-place",
    category: "Jollof",
    avg_prep_mins: 25,
    rating_avg: 4.8,
    rating_count: 234,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "2",
    name: "Mama Cass",
    slug: "mama-cass",
    category: "Soups",
    avg_prep_mins: 20,
    rating_avg: 4.6,
    rating_count: 189,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "3",
    name: "Kitchen Muse",
    slug: "kitchen-muse",
    category: "Grills",
    avg_prep_mins: 30,
    rating_avg: 4.7,
    rating_count: 156,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "4",
    name: "Iyan Aladuke",
    slug: "iyan-aladuke",
    category: "Swallow",
    avg_prep_mins: 15,
    rating_avg: 4.9,
    rating_count: 312,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "5",
    name: "Tasty Bites",
    slug: "tasty-bites",
    category: "Sides",
    avg_prep_mins: 10,
    rating_avg: 4.3,
    rating_count: 98,
    banner_url: null,
    is_accepting_orders: false,
  },
  {
    id: "6",
    name: "Spice Haven",
    slug: "spice-haven",
    category: "Drinks",
    avg_prep_mins: 12,
    rating_avg: 4.5,
    rating_count: 145,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "7",
    name: "Naija Kitchen",
    slug: "naija-kitchen",
    category: "Jollof",
    avg_prep_mins: 28,
    rating_avg: 4.4,
    rating_count: 201,
    banner_url: null,
    is_accepting_orders: true,
  },
  {
    id: "8",
    name: "Soul Food",
    slug: "soul-food",
    category: "Grills",
    avg_prep_mins: 22,
    rating_avg: 4.2,
    rating_count: 87,
    banner_url: null,
    is_accepting_orders: false,
  },
];

export default async function CustomerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;

  // Use dummy data for development
  const useDummyData = true; // Set to false when you want real data

  let vendors = null;

  if (useDummyData) {
    // Filter dummy data based on search params
    let filtered = DUMMY_VENDORS;
    if (q) {
      filtered = filtered.filter((v) =>
        v.name.toLowerCase().includes(q.toLowerCase()),
      );
    }
    if (category) {
      filtered = filtered.filter((v) => v.category === category);
    }
    vendors = filtered;
  } else {
    // Real Supabase query
    const supabase = await createClient();
    let query = supabase
      .from("vendors")
      .select(
        "id, name, slug, category, avg_prep_mins, rating_avg, rating_count, banner_url, is_accepting_orders",
      )
      .eq("status", "active")
      .order("rating_avg", { ascending: false })
      .limit(30);

    if (q) query = query.ilike("name", `%${q}%`);
    if (category) query = query.eq("category", category);

    const { data } = await query;
    vendors = data;
  }

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6">
      {/* Hero Banner - Desktop */}
      <div className="relative mb-8 hidden h-[392px] overflow-hidden rounded-2xl border border-[#E5E2E1] bg-[#F6F3F2] sm:block">
        <div className="absolute inset-0">
          <div
            className="h-full w-full bg-cover bg-center opacity-90"
            style={{ backgroundImage: "url('/assets/hero-banner.png')" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#FCF9F8] via-[rgba(252,249,248,0.8)] to-transparent" />
        </div>
        <div className="relative flex h-full flex-col justify-center px-12 py-10">
          <Badge className="mb-4 w-fit bg-[#FE8E27] text-[#653200] hover:bg-[#FE8E27]">
            <span className="text-xs p-2 font-bold uppercase tracking-[0.6px]">
              Limited Time Offer
            </span>
          </Badge>
          <h1 className="max-w-[257px] font-sora text-[48px] font-extrabold leading-[56px] tracking-[-0.96px] text-[#1C1B1B]">
            20% off Jollof Rice
          </h1>
          <p className="mt-2 text-[18px] leading-7 text-[#5B403C]">
            Use code{" "}
            <span className="rounded-md bg-[#E5E2E1] px-2 py-0.5 font-semibold text-[#1C1B1B]">
              JOLLOF20
            </span>{" "}
            at checkout
          </p>
          <Link
            href="/vendors"
            className="mt-4 flex w-fit items-center gap-2 rounded-xl bg-[#E23B2E] px-6 py-3 font-inter text-sm font-semibold text-white hover:bg-[#c42a1f]"
          >
            Order Now
          </Link>
        </div>
        {/* Carousel dots (visual only) */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          <span className="h-2 w-8 rounded-full bg-[#E23B2E]" />
          <span className="h-2 w-2 rounded-full bg-[#E5E2E1]" />
          <span className="h-2 w-2 rounded-full bg-[#E5E2E1]" />
        </div>
      </div>

      {/* Mobile Promo Banner */}
      <div className="relative mb-6 h-[160px] overflow-hidden rounded-xl shadow-sm sm:hidden">
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: "url('/assets/hero-banner.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <Badge className="mb-2 bg-[#FE8E27] text-[#653200] hover:bg-[#FE8E27]">
            <span className="text-[10px] p-1 font-bold uppercase tracking-[0.5px]">
              Limited Time Offer
            </span>
          </Badge>
          <h2 className="font-sora text-[28px] font-bold leading-[34px] text-white">
            20% off Jollof Rice
          </h2>
          <p className="text-sm text-white/90">Use code JOLLOF20</p>
        </div>
      </div>

      {/* Categories Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-2xl">
            Categories
          </h2>
          {category && (
            <Link
              href="/home"
              className="font-inter text-sm font-semibold text-[#B61913] hover:underline"
            >
              Clear filter
            </Link>
          )}
        </div>

        {/* Desktop: Text-based pills */}
        <div className="mt-4 hidden gap-3 overflow-x-auto pb-2 sm:flex sm:gap-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/home?category=${encodeURIComponent(c)}`}
              className={cn(
                "shrink-0 rounded-full px-6 py-2 font-inter text-sm font-semibold leading-5 tracking-[0.14px]",
                category === c
                  ? "bg-[#DA3529] text-[#FFFBFF]"
                  : "border border-[#E5E2E1] bg-[#EAE7E7] text-[#5B403C] hover:bg-[#ddd9d9]",
              )}
            >
              {c}
            </Link>
          ))}
        </div>

        {/* Mobile: Icon-based scrollable categories */}
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2 sm:hidden [-webkit-overflow-scrolling:touch]">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/home?category=${encodeURIComponent(c)}`}
              className="flex shrink-0 flex-col items-center gap-2"
            >
              <div
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm transition-colors",
                  category === c
                    ? "bg-[#DA3529]"
                    : "bg-[#F0EDED] hover:bg-[#e5e2e2]",
                )}
              >
                <div className={category === c ? "text-white" : ""}>
                  {CATEGORY_ICONS[c] || (
                    <Utensils className="size-5 text-[#5B403C]" />
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "font-inter text-xs font-medium leading-4 text-[#5B403C]",
                  category === c && "font-semibold text-[#DA3529]",
                )}
              >
                {c}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Nearby Vendors */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Nearby Favorites
          </h2>
          <Link
            href="/vendors"
            className="flex items-center gap-1 font-inter text-sm font-semibold text-[#E23B2E] hover:underline"
          >
            See all
            <span className="text-[#E23B2E]">→</span>
          </Link>
        </div>

        {!vendors || vendors.length === 0 ? (
          <p className="mt-4 text-sm text-[#5B403C]">
            No vendors match{q ? ` "${q}"` : ""}
            {category ? ` in ${category}` : ""} yet.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {vendors.map((vendor) => (
              <Link key={vendor.id} href={`/vendors/${vendor.slug}`}>
                <Card className="overflow-hidden border border-[#E5E2E1] p-0 transition-shadow hover:shadow-md">
                  <div
                    className="h-[160px] w-full bg-[#EAE7E7] bg-cover bg-center"
                    style={
                      vendor.banner_url
                        ? { backgroundImage: `url(${vendor.banner_url})` }
                        : {
                            backgroundImage:
                              "url('/assets/vendor-placeholder.png')",
                          }
                    }
                  />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-sora text-lg font-bold text-[#1C1B1B]">
                        {vendor.name}
                      </h3>
                      {vendor.rating_count > 0 && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgba(252,249,248,0.9)] px-2 py-0.5 text-xs font-bold text-[#1C1B1B] backdrop-blur-sm">
                          <Star className="size-3 fill-[#FE8E27] text-[#FE8E27]" />
                          {vendor.rating_avg.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-inter text-sm capitalize text-[#5B403C]">
                      {vendor.category || "Various"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          vendor.is_accepting_orders ? "positive" : "neutral"
                        }
                        className="text-xs"
                      >
                        {vendor.is_accepting_orders
                          ? `~${vendor.avg_prep_mins || 15} min prep`
                          : "Currently closed"}
                      </Badge>
                      <span className="text-xs text-[#5B403C]">
                        {vendor.rating_count}{" "}
                        {vendor.rating_count === 1 ? "review" : "reviews"}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
