// app/(customer)/home/_components/VendorCard.tsx
import { Clock3, MapPin, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { isVendorOpenNow } from "../_lib/opening-hours";

export interface VendorCardVendor {
  id: string;
  name: string;
  slug: string;
  category: string;
  avg_prep_mins: number;
  rating_avg: number;
  rating_count: number;
  banner_url: string | null;
  is_accepting_orders: boolean;
  opening_hours: unknown;
  state?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  /** Straight-line distance from the customer, in meters — set by
   * withDistanceSorted() in page.tsx once the customer's own coordinates are
   * known; absent (not just null) whenever that context isn't available, so
   * the card never renders a stale or fabricated distance. */
  distanceM?: number | null;
}

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/**
 * Reference (Chowdeck) vendor cards also show a heart/wishlist icon and a
 * static delivery-fee badge — there's no wishlist table in this schema and
 * no per-vendor fixed delivery fee (KiaKia prices delivery per-order from
 * distance x the vendor's service area rate, per AGENTS.md), so both are
 * omitted rather than faked. A "verified" ribbon is also skipped: every
 * vendor reaching this list is already status = 'active' (the query filters
 * on it), so the badge would be true on 100% of cards and convey nothing.
 *
 * Banners go through next/image rather than a CSS background-image: they are
 * Supabase public URLs, which next.config.ts already scopes remotePatterns
 * to, so this is the difference between shipping a vendor's full-size upload
 * to every visitor and shipping a card-sized AVIF.
 */
export function VendorCard({ vendor }: { vendor: VendorCardVendor }) {
  const openNow = isVendorOpenNow(vendor);

  return (
    <Link
      href={`/vendors/${vendor.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-kk-line/60 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-[0_26px_46px_-26px_rgba(90,25,20,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red/45 focus-visible:ring-offset-2"
    >
      <div className="relative aspect-16/10 w-full overflow-hidden bg-kk-sand">
        {vendor.banner_url ? (
          <Image
            src={vendor.banner_url}
            alt=""
            fill
            sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 92vw"
            className={`object-cover transition-transform duration-700 group-hover:scale-[1.06] ${
              openNow ? "" : "grayscale-[45%]"
            }`}
          />
        ) : (
          // No stock photo stands in for a vendor that hasn't uploaded one —
          // a tinted monogram is honest about there being no image yet, and
          // costs no request. (The old code pointed at an
          // /assets/vendor-placeholder.png that was never added to the repo.)
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-kk-red-soft via-kk-cream to-kk-orange/25">
            <span aria-hidden="true" className="font-sora text-5xl font-extrabold text-kk-red/30">
              {vendor.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          </span>
        )}

        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-kk-ink-deep/45 via-transparent to-transparent"
        />

        {vendor.rating_count > 0 && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 font-inter text-xs font-bold text-kk-ink shadow-sm backdrop-blur-sm">
            <Star className="size-3 fill-kk-orange text-kk-orange" />
            {vendor.rating_avg.toFixed(1)}
          </span>
        )}

        {!openNow && (
          <span className="absolute left-3 top-3 rounded-full bg-kk-ink-deep/85 px-2.5 py-1 font-inter text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
            Closed now
          </span>
        )}

        <span className="absolute bottom-3 left-3 right-3 truncate font-inter text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85">
          {vendor.category || "Various"}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-sora text-[17px] font-bold leading-6 tracking-tight text-kk-ink transition-colors group-hover:text-kk-red">
          {vendor.name}
        </h3>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3 font-inter text-xs text-kk-cocoa">
          {openNow ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-kk-mint/35 px-2.5 py-1 font-semibold text-kk-green">
              <Clock3 className="size-3.5" />~{vendor.avg_prep_mins || 15} min prep
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-kk-sand px-2.5 py-1 font-semibold text-kk-cocoa">
              <Clock3 className="size-3.5" />
              Opens later
            </span>
          )}

          {vendor.distanceM != null && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 shrink-0 text-kk-red" />
              {formatDistance(vendor.distanceM)}
            </span>
          )}

          <span className="text-kk-cocoa/70">
            {vendor.rating_count > 0
              ? `${vendor.rating_count} ${vendor.rating_count === 1 ? "review" : "reviews"}`
              : "No reviews yet"}
          </span>
        </div>
      </div>
    </Link>
  );
}
