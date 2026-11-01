// app/(vendor)/menu/_components/MenuCard.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Pencil, Utensils } from "lucide-react";
import { AvailabilityToggle, DeleteItemButton } from "./MenuItemRowActions";
import type { MenuItem } from "./types";

interface MenuCardProps {
  item: MenuItem;
  vendorId: string;
  onToggleAvailability: (itemId: string, isAvailable: boolean) => void;
}

export function MenuCard({
  item,
  vendorId,
  onToggleAvailability,
}: MenuCardProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-kk-line bg-kk-card shadow-sm transition-all hover:shadow-lg">
      {/* Image */}
      <div className="relative h-48 w-full overflow-hidden bg-kk-fill">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-kk-fill">
            <Utensils className="size-12 text-kk-cocoa/30" />
          </div>
        )}
        <Link
          href={`/dashboard/menu/items/${item.id}/edit`}
          className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-kk-card/90 text-kk-cocoa shadow-sm backdrop-blur transition-colors hover:bg-kk-card hover:text-kk-red-ink"
          aria-label="Edit item"
        >
          <Pencil className="size-4" />
        </Link>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="font-inter font-bold text-kk-ink">{item.name}</h3>
            <span className="shrink-0 font-bold text-kk-red-ink">
              {formatNaira(koboOf(item.price_kobo))}
            </span>
          </div>
          <p className="text-sm text-kk-cocoa line-clamp-2">
            {item.description || "Delicious menu item"}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[rgba(228,190,184,0.3)] pt-4">
          <span
            className={`text-xs font-medium ${
              item.is_available ? "text-kk-green-ink" : "text-kk-danger-ink"
            }`}
          >
            {item.is_available ? "In Stock" : "Out of Stock"}
          </span>
          <div className="flex items-center gap-1">
            <AvailabilityToggle
              vendorId={vendorId}
              itemId={item.id}
              initialValue={item.is_available}
              onToggle={(isAvailable) =>
                onToggleAvailability(item.id, isAvailable)
              }
            />
            <DeleteItemButton vendorId={vendorId} itemId={item.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
