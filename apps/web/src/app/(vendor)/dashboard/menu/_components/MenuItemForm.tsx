"use client";

import { createMenuItemAction, updateMenuItemAction, type FormState } from "@/app/actions/menu";
import { applyBps, formatNaira, koboOf, MEAL_CATEGORIES, subtractKobo } from "@kiakia/domain";
import { ImagePlus, Loader2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { OptionGroupsBuilder, type OptionGroupState } from "./OptionGroupsBuilder";

interface ExistingItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly priceKobo: number;
  /** The preset key (MEAL_CATEGORIES) of the item's current category, or
   * null when uncategorized — not menu_categories.id, since that row may
   * not exist yet for a preset the vendor hasn't picked before (see
   * resolveCategoryId in actions/menu.ts, which creates it on save). */
  readonly categoryKey: string | null;
  readonly isAvailable: boolean;
  readonly optionGroups: readonly OptionGroupState[];
}

const inputClass =
  "mt-1.5 w-full rounded-xl border border-kk-line bg-kk-card px-3.5 py-2.5 text-sm text-kk-ink outline-none placeholder:text-kk-cocoa/50 focus:border-kk-red focus:ring-2 focus:ring-kk-red-ink/20";

const initialState: FormState = {};

export function MenuItemForm({
  vendorId,
  commissionBps,
  existingItem,
}: {
  vendorId: string;
  /** vendors.commission_bps — used only to show the vendor their own net
   * payout as they type a price, never sent anywhere: place_order() and
   * verify_delivery_and_release_escrow() re-derive the real commission
   * server-side from the live vendors row at order time, not from
   * anything this form computes. */
  commissionBps: number;
  existingItem?: ExistingItem;
}) {
  const action = existingItem ? updateMenuItemAction : createMenuItemAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [groups, setGroups] = useState<OptionGroupState[]>([...(existingItem?.optionGroups ?? [])]);
  const [preview, setPreview] = useState<string | null>(existingItem?.imageUrl ?? null);
  const [priceNaira, setPriceNaira] = useState(
    existingItem ? String(existingItem.priceKobo / 100) : "",
  );

  const payout = useMemo(() => {
    const naira = Number.parseFloat(priceNaira);
    if (!Number.isFinite(naira) || naira <= 0) return null;
    const priceKobo = koboOf(Math.round(naira * 100));
    const commissionKobo = applyBps(priceKobo, commissionBps);
    return { commissionKobo, netKobo: subtractKobo(priceKobo, commissionKobo) };
  }, [priceNaira, commissionBps]);

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
        <label className="text-sm font-semibold text-kk-ink">Photo</label>
        <p className="text-xs text-kk-cocoa">Optional, but items with photos sell better.</p>
        <div className="mt-2 flex items-center gap-4">
          <label
            htmlFor="image"
            className="relative flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-kk-line bg-kk-sand transition-colors hover:border-kk-red/50"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- transient local/uploaded preview, not an optimizable remote asset
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="size-6 text-kk-cocoa/40" />
            )}
          </label>
          <div className="text-xs text-kk-cocoa">
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
        <label htmlFor="name" className="text-sm font-semibold text-kk-ink">
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
        <label htmlFor="description" className="text-sm font-semibold text-kk-ink">
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
          <label htmlFor="priceNaira" className="text-sm font-semibold text-kk-ink">
            Price (₦)
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-kk-cocoa">
              ₦
            </span>
            <input
              id="priceNaira"
              name="priceNaira"
              type="number"
              min={0}
              step="0.01"
              required
              value={priceNaira}
              onChange={(event) => setPriceNaira(event.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-kk-line bg-kk-card py-2.5 pl-7 pr-3.5 text-sm text-kk-ink outline-none placeholder:text-kk-cocoa/50 focus:border-kk-red focus:ring-2 focus:ring-kk-red-ink/20"
            />
          </div>
          {/* KiaKia's commission (vendors.commission_bps) comes straight off
              the price the vendor sets here, same math
              verify_delivery_and_release_escrow() actually pays out on
              delivery (0044) — shown live so pricing isn't a guess about
              what lands in their balance. */}
          {payout && (
            <p className="mt-1.5 text-xs text-kk-cocoa">
              You&apos;ll receive <span className="font-semibold text-kk-green-ink">{formatNaira(payout.netKobo)}</span>{" "}
              after KiaKia&apos;s {(commissionBps / 100).toFixed(1)}% commission ({formatNaira(payout.commissionKobo)})
            </p>
          )}
        </div>

        {/* Category */}
        <div>
          <label htmlFor="categoryKey" className="text-sm font-semibold text-kk-ink">
            Category
          </label>
          <select
            id="categoryKey"
            name="categoryKey"
            defaultValue={existingItem?.categoryKey ?? ""}
            className={inputClass}
          >
            <option value="">Uncategorized</option>
            {MEAL_CATEGORIES.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Availability */}
      <label className="flex items-center gap-3 rounded-xl border border-kk-line bg-kk-sand px-4 py-3">
        <input
          type="checkbox"
          name="isAvailable"
          defaultChecked={existingItem?.isAvailable ?? true}
          className="size-4 rounded border-kk-line text-kk-red-ink focus:ring-kk-red-ink/40"
        />
        <span className="text-sm font-medium text-kk-ink">Available for order</span>
      </label>

      {/* Options */}
      <div>
        <h2 className="text-sm font-semibold text-kk-ink">Options (e.g. sizes, extras)</h2>
        <div className="mt-2">
          <OptionGroupsBuilder groups={groups} onChange={setGroups} />
        </div>
      </div>

      {state.error && (
        <p className="rounded-xl bg-kk-danger-wash px-4 py-3 text-sm font-medium text-kk-danger-ink">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-kk-red py-3.5 text-sm font-bold text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {existingItem ? "Save changes" : "Add item"}
      </button>
    </form>
  );
}
