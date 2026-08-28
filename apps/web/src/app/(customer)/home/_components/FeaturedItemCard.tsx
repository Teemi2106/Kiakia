// app/(customer)/home/_components/FeaturedItemCard.tsx
import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { isVendorOpenNow } from "../_lib/opening-hours";
import type { VendorCardVendor } from "./VendorCard";

/**
 * Unlike VendorCard (vendor-centric — used for the "Top rated"/"All vendors"
 * grids below), this card is dish-centric: the photo is a real menu item, so
 * the dish name is the headline and the vendor is a subtitle, not the other
 * way around. Still links to the vendor's page — there's no per-dish page in
 * this app — and still surfaces open/closed + rating, since that's real,
 * useful signal for something you're about to tap expecting to order.
 *
 * The whole card is the photo, with the text sitting on a scrim over it: a
 * featured strip earns its place by being appetising, and a food photo
 * cropped into the top third of a white card is not.
 */
export function FeaturedItemCard({
  vendor,
  dishName,
  dishImageUrl,
  className,
}: {
  vendor: VendorCardVendor;
  dishName: string;
  dishImageUrl: string;
  className?: string;
}) {
  const openNow = isVendorOpenNow(vendor);

  return (
    <Link
      href={`/vendors/${vendor.slug}`}
      className={`group relative block aspect-4/5 overflow-hidden rounded-3xl bg-kk-sand transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_26px_46px_-24px_rgba(90,25,20,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red/45 focus-visible:ring-offset-2 ${className ?? ""}`}
    >
      <Image
        src={dishImageUrl}
        alt=""
        fill
        sizes="(min-width: 640px) 260px, 60vw"
        className="object-cover transition-transform duration-700 group-hover:scale-[1.07]"
      />

      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-kk-ink-deep via-kk-ink-deep/35 to-transparent"
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

      <div className="absolute inset-x-0 bottom-0 p-4">
        <h3 className="line-clamp-2 font-sora text-lg font-bold leading-6 tracking-tight text-white">
          {dishName}
        </h3>
        <p className="mt-1.5 truncate font-inter text-xs text-white/70">{vendor.name}</p>
        <span className="mt-3 inline-flex translate-y-1 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 font-inter text-[11px] font-semibold text-white opacity-0 ring-1 ring-inset ring-white/25 backdrop-blur-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          View menu
        </span>
      </div>
    </Link>
  );
}
