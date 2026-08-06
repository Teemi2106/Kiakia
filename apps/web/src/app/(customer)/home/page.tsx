import { Badge, Card } from "@kiakia/ui";
import { Search, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home" };

const CATEGORIES = ["Jollof", "Soups", "Swallow", "Grills", "Sides", "Drinks"] as const;

export default async function CustomerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("vendors")
    .select("id, name, slug, category, avg_prep_mins, rating_avg, rating_count, banner_url, is_accepting_orders")
    .eq("status", "active")
    .order("rating_avg", { ascending: false })
    .limit(30);

  if (q) query = query.ilike("name", `%${q}%`);
  if (category) query = query.eq("category", category);

  const { data: vendors } = await query;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
      <form action="/home" method="GET" className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="What are you craving?"
          className="h-11 w-full rounded-control border border-border bg-surface-raised pl-10 pr-3 text-sm text-ink outline-none focus:border-brand-500"
        />
      </form>

      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Categories</h2>
        {category && (
          <Link href="/home" className="text-xs font-medium text-brand-600 hover:underline">
            Clear filter
          </Link>
        )}
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/home?category=${encodeURIComponent(c)}`}
            className={`shrink-0 rounded-pill px-4 py-2 text-xs font-medium ${
              category === c ? "bg-brand-500 text-white" : "bg-surface-sunken text-ink-muted"
            }`}
          >
            {c}
          </Link>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink">Nearby Vendors</h2>

      {!vendors || vendors.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          No vendors match{q ? ` "${q}"` : ""}
          {category ? ` in ${category}` : ""} yet.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {vendors.map((vendor) => (
            <Link key={vendor.id} href={`/vendors/${vendor.slug}`}>
              <Card className="overflow-hidden p-0">
                <div
                  className="h-32 w-full bg-surface-sunken bg-cover bg-center"
                  style={vendor.banner_url ? { backgroundImage: `url(${vendor.banner_url})` } : undefined}
                />
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-ink">{vendor.name}</h3>
                    {vendor.rating_count > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink">
                        <Star className="size-3.5 fill-warning text-warning" />
                        {vendor.rating_avg.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted capitalize">{vendor.category}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge tone={vendor.is_accepting_orders ? "positive" : "neutral"}>
                      {vendor.is_accepting_orders ? `~${vendor.avg_prep_mins} min prep` : "Currently closed"}
                    </Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
