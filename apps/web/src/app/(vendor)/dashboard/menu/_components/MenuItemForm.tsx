"use client";

import { createMenuItemAction, updateMenuItemAction, type FormState } from "@/app/actions/menu";
import { ImagePlus, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import type { ChangeEvent } from "react";
import { OptionGroupsBuilder, type OptionGroupState } from "./OptionGroupsBuilder";

interface Category {
  readonly id: string;
  readonly name: string;
}

interface ExistingItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly priceKobo: number;
  readonly categoryId: string | null;
  readonly isAvailable: boolean;
  readonly optionGroups: readonly OptionGroupState[];
}

const inputClass =
  "mt-1.5 w-full rounded-xl border border-[#E4BEB8] bg-white px-3.5 py-2.5 text-sm text-[#1C1B1B] outline-none placeholder:text-[#5B403C]/50 focus:border-[#B61913] focus:ring-2 focus:ring-[#B61913]/20";

const initialState: FormState = {};

export function MenuItemForm({
  vendorId,
  categories,
  existingItem,
}: {
  vendorId: string;
  categories: readonly Category[];
  existingItem?: ExistingItem;
}) {
  const action = existingItem ? updateMenuItemAction : createMenuItemAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [groups, setGroups] = useState<OptionGroupState[]>([...(existingItem?.optionGroups ?? [])]);
  const [preview, setPreview] = useState<string | null>(existingItem?.imageUrl ?? null);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="vendorId" value={vendorId} />
      {existingItem && <input type="hidden" name="itemId" value={existingItem.id} />}
      <input type="hidden" name="optionGroups" value={JSON.stringify(groups)} />

      {/* Photo */}
      <div>
        <label className="text-sm font-semibold text-[#1C1B1B]">Photo</label>
        <p className="text-xs text-[#5B403C]">Optional, but items with photos sell better.</p>
        <div className="mt-2 flex items-center gap-4">
          <label
            htmlFor="image"
            className="relative flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#E4BEB8] bg-[#F6F3F2] transition-colors hover:border-[#B61913]/50"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- transient local/uploaded preview, not an optimizable remote asset
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="size-6 text-[#5B403C]/40" />
            )}
          </label>
          <div className="text-xs text-[#5B403C]">
            PNG, JPG, WEBP or AVIF.
            <br />
            Click the square to {preview ? "replace" : "upload"} a photo.
          </div>
        </div>
        <input type="hidden" name="currentImageUrl" value={existingItem?.imageUrl ?? ""} />
        <input
          id="image"
          name="image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          onChange={handleImageChange}
          className="sr-only"
        />
      </div>

      {/* Name */}
      <div>
        <label htmlFor="name" className="text-sm font-semibold text-[#1C1B1B]">
          Item Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={existingItem?.name}
          placeholder="e.g. Jollof Rice & Chicken"
          className={inputClass}
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="text-sm font-semibold text-[#1C1B1B]">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={existingItem?.description ?? ""}
          placeholder="A short, appetizing description for customers"
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Price */}
        <div>
          <label htmlFor="priceNaira" className="text-sm font-semibold text-[#1C1B1B]">
            Price (₦)
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-[#5B403C]">
              ₦
            </span>
            <input
              id="priceNaira"
              name="priceNaira"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={existingItem ? existingItem.priceKobo / 100 : undefined}
              placeholder="0.00"
              className="w-full rounded-xl border border-[#E4BEB8] bg-white py-2.5 pl-7 pr-3.5 text-sm text-[#1C1B1B] outline-none placeholder:text-[#5B403C]/50 focus:border-[#B61913] focus:ring-2 focus:ring-[#B61913]/20"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="categoryId" className="text-sm font-semibold text-[#1C1B1B]">
            Category
          </label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={existingItem?.categoryId ?? ""}
            className={inputClass}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Availability */}
      <label className="flex items-center gap-3 rounded-xl border border-[#E4BEB8] bg-[#F6F3F2] px-4 py-3">
        <input
          type="checkbox"
          name="isAvailable"
          defaultChecked={existingItem?.isAvailable ?? true}
          className="size-4 rounded border-[#E4BEB8] text-[#B61913] focus:ring-[#B61913]/40"
        />
        <span className="text-sm font-medium text-[#1C1B1B]">Available for order</span>
      </label>

      {/* Options */}
      <div>
        <h2 className="text-sm font-semibold text-[#1C1B1B]">Options (e.g. sizes, extras)</h2>
        <div className="mt-2">
          <OptionGroupsBuilder groups={groups} onChange={setGroups} />
        </div>
      </div>

      {state.error && (
        <p className="rounded-xl bg-[#FFDAD5] px-4 py-3 text-sm font-medium text-[#BA1A1A]">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#9e1611] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {existingItem ? "Save changes" : "Add item"}
      </button>
    </form>
  );
}
