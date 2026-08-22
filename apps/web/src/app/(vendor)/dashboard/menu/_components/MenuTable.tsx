// app/(vendor)/menu/_components/MenuTable.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Pencil, Utensils } from "lucide-react";
import { AvailabilityToggle, DeleteItemButton } from "./MenuItemRowActions";

import type { MenuItem } from "./types";

interface MenuTableProps {
  items: MenuItem[];
  vendorId: string;
  onToggleAvailability: (itemId: string, isAvailable: boolean) => void;
}

export function MenuTable({
  items,
  vendorId,
  onToggleAvailability,
}: MenuTableProps) {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Rice":
        return "bg-[#FFDCC5] text-[#703800]";
      case "Swallow":
        return "bg-[#FFDAD5] text-[#930004]";
      case "Sides":
        return "bg-[#A3F69D] text-[#005313]";
      default:
        return "bg-[#F0EDED] text-[#5B403C]";
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-[#F6F3F2]">
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C]">
              Photo
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C]">
              Item Name
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C]">
              Category
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C]">
              Price (₦)
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C]">
              In Stock
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-[#5B403C] text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E4BEB8]">
          {items.map((item) => (
            <tr
              key={item.id}
              className="hover:bg-[#F6F3F2] transition-colors group"
            >
              {/* Image */}
              <td className="px-6 py-4">
                <div className="h-16 w-16 overflow-hidden rounded-xl shadow-sm">
                  {item.image_url ? (
                    <Image
                      src={item.image_url}
                      alt={item.name}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
                      <Utensils className="size-6 text-[#5B403C]/40" />
                    </div>
                  )}
                </div>
              </td>

              {/* Name */}
              <td className="px-6 py-4">
                <span className="font-inter font-semibold text-[#1C1B1B]">
                  {item.name}
                </span>
              </td>

              {/* Category */}
              <td className="px-6 py-4">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getCategoryColor(
                    item.category_id || "Other",
                  )}`}
                >
                  {item.category_id || "Other"}
                </span>
              </td>

              {/* Price */}
              <td className="px-6 py-4">
                <span className="font-inter font-bold text-[#1C1B1B]">
                  {formatNaira(koboOf(item.price_kobo))}
                </span>
              </td>

              {/* Availability Toggle */}
              <td className="px-6 py-4">
                <AvailabilityToggle
                  vendorId={vendorId}
                  itemId={item.id}
                  initialValue={item.is_available}
                  onToggle={(isAvailable) =>
                    onToggleAvailability(item.id, isAvailable)
                  }
                />
              </td>

              {/* Actions */}
              <td className="px-6 py-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/dashboard/menu/items/${item.id}/edit`}
                    className="rounded-lg p-2 text-[#5B403C] transition-colors hover:text-[#B61913]"
                    aria-label="Edit item"
                  >
                    <Pencil className="size-4" />
                  </Link>
                  <DeleteItemButton vendorId={vendorId} itemId={item.id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
