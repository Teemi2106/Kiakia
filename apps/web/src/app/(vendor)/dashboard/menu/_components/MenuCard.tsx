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
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[#E4BEB8] bg-white shadow-sm transition-all hover:shadow-lg">
      {/* Image */}
      <div className="relative h-48 w-full overflow-hidden bg-[#F0EDED]">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
            <Utensils className="size-12 text-[#5B403C]/30" />
          </div>
        )}
        <Link
          href={`/dashboard/menu/items/${item.id}/edit`}
          className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-white/90 text-[#5B403C] shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-[#B61913]"
          aria-label="Edit item"
        >
          <Pencil className="size-4" />
        </Link>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="mb-1 flex items-start justify-between gap-2">
            <h3 className="font-inter font-bold text-[#1C1B1B]">{item.name}</h3>
            <span className="shrink-0 font-bold text-[#B61913]">
              {formatNaira(koboOf(item.price_kobo))}
            </span>
          </div>
          <p className="text-sm text-[#5B403C] line-clamp-2">
            {item.description || "Delicious menu item"}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[rgba(228,190,184,0.3)] pt-4">
          <span
            className={`text-xs font-medium ${
              item.is_available ? "text-[#176A22]" : "text-[#BA1A1A]"
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
