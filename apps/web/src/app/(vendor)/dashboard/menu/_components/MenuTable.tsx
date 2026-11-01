// app/(vendor)/menu/_components/MenuTable.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Pencil, Utensils } from "lucide-react";
import { AvailabilityToggle, DeleteItemButton } from "./MenuItemRowActions";

import type { Category, MenuItem } from "./types";

interface MenuTableProps {
  items: MenuItem[];
  categories: Category[];
  vendorId: string;
  onToggleAvailability: (itemId: string, isAvailable: boolean) => void;
}

const CATEGORY_COLORS = [
  "bg-[#FFDCC5] text-[#703800]",
  "bg-[#FFDAD5] text-[#930004]",
  "bg-kk-green-wash text-kk-green-ink",
  "bg-[#E4D9FF] text-[#5B21B6]",
  "bg-[#D6EFFF] text-[#0B5A8A]",
];

export function MenuTable({
  items,
  categories,
  vendorId,
  onToggleAvailability,
}: MenuTableProps) {
  const getCategoryLabel = (categoryId: string | null) => {
    if (!categoryId) return "Uncategorized";
    return categories.find((c) => c.id === categoryId)?.name ?? "Uncategorized";
  };

  const getCategoryColor = (categoryId: string | null) => {
    if (!categoryId) return "bg-kk-fill text-kk-cocoa";
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index === -1) return "bg-kk-fill text-kk-cocoa";
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-kk-sand">
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa">
              Photo
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa">
              Item Name
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa">
              Category
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa">
              Price (₦)
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa">
              In Stock
            </th>
            <th className="px-6 py-4 font-inter text-sm font-medium text-kk-cocoa text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-kk-line">
          {items.map((item) => (
            <tr
              key={item.id}
              className="hover:bg-kk-sand transition-colors group"
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
                    <div className="flex h-full w-full items-center justify-center bg-kk-fill">
                      <Utensils className="size-6 text-kk-cocoa/40" />
                    </div>
                  )}
                </div>
              </td>

              {/* Name */}
              <td className="px-6 py-4">
                <span className="font-inter font-semibold text-kk-ink">
                  {item.name}
                </span>
              </td>

              {/* Category */}
              <td className="px-6 py-4">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getCategoryColor(
                    item.category_id,
                  )}`}
                >
                  {getCategoryLabel(item.category_id)}
                </span>
              </td>

              {/* Price */}
              <td className="px-6 py-4">
                <span className="font-inter font-bold text-kk-ink">
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
                    className="rounded-lg p-2 text-kk-cocoa transition-colors hover:bg-kk-fill hover:text-kk-red-ink"
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
