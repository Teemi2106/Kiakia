"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button, cn } from "@kiakia/ui";
import { Minus, Plus, UtensilsCrossed, X } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import type { MenuItem } from "./types";

export function ItemOptionsSheet({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (
    selectedOptionIds: readonly string[],
    qty: number,
  ) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const totalKobo = useMemo(() => {
    const optionsTotal = item.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selected.has(o.id))
      .reduce((sum, o) => sum + o.priceDeltaKobo, 0);
    return (item.priceKobo + optionsTotal) * qty;
  }, [item, selected, qty]);

  function toggleOption(
    group: MenuItem["optionGroups"][number],
    optionId: string,
  ) {
    setSelected((prev) => {
      const next = new Set(prev);
      const groupOptionIds = new Set(group.options.map((o) => o.id));

      if (group.maxSelect === 1) {
        // Single-select group: picking one clears any other choice in the same group.
        for (const id of groupOptionIds) next.delete(id);
        next.add(optionId);
        return next;
      }

      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }

      const currentInGroup = [...next].filter((id) =>
        groupOptionIds.has(id),
      ).length;
      if (currentInGroup >= group.maxSelect) return prev; // at the cap, ignore
      next.add(optionId);
      return next;
    });
  }

  const missingRequiredGroup = item.optionGroups.find((group) => {
    if (!group.isRequired) return false;
    const chosenInGroup = group.options.filter((o) =>
      selected.has(o.id),
    ).length;
    return chosenInGroup < group.minSelect;
  });

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm([...selected], qty);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-48 w-full shrink-0 overflow-hidden bg-[#F0EDED]">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              sizes="448px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <UtensilsCrossed className="size-10 text-[#5B403C]/30" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-full bg-white/90 p-1.5 text-[#1C1B1B] shadow-sm transition-colors hover:bg-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5">
          <div>
            <h2 className="font-sora text-lg font-semibold text-[#1C1B1B]">
              {item.name}
            </h2>
            {item.description && (
              <p className="mt-1 text-sm text-[#5B403C]">
                {item.description}
              </p>
            )}
            <p className="mt-2 font-inter text-sm font-bold text-[#B61913]">
              {formatNaira(koboOf(item.priceKobo))}
            </p>
          </div>

          {item.optionGroups.map((group) => (
            <fieldset key={group.id} className="mt-5">
              <div className="flex items-center gap-2">
                <legend className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {group.name}
                </legend>
                {group.isRequired ? (
                  <span className="rounded-full bg-[#B61913]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B61913]">
                    Required
                  </span>
                ) : group.maxSelect > 1 ? (
                  <span className="rounded-full bg-[#F0EDED] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#5B403C]">
                    Select up to {group.maxSelect}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {group.options.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      "flex items-center justify-between rounded-xl border border-[#E4BEB8] px-3 py-2 text-sm transition-colors",
                      selected.has(option.id)
                        ? "border-[#B61913] bg-[rgba(218,53,41,0.05)]"
                        : "hover:border-[#5B403C]/40",
                      !option.isAvailable && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="flex items-center gap-2 text-[#1C1B1B]">
                      <input
                        type={group.maxSelect === 1 ? "radio" : "checkbox"}
                        name={group.id}
                        checked={selected.has(option.id)}
                        disabled={!option.isAvailable}
                        onChange={() => toggleOption(group, option.id)}
                        className="accent-[#B61913]"
                      />
                      {option.name}
                    </span>
                    {option.priceDeltaKobo > 0 && (
                      <span className="text-[#5B403C]">
                        +{formatNaira(koboOf(option.priceDeltaKobo))}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="mt-6 flex items-center justify-between border-t border-[#E5E2E1] pt-4">
            <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
              Quantity
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
                className="flex size-8 items-center justify-center rounded-full border border-[#E4BEB8] text-[#1C1B1B] transition-colors hover:bg-[#F0EDED] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-4 text-center text-sm font-semibold text-[#1C1B1B]">
                {qty}
              </span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                aria-label="Increase quantity"
                className="flex size-8 items-center justify-center rounded-full border border-[#E4BEB8] text-[#1C1B1B] transition-colors hover:bg-[#F0EDED]"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          <Button
            className="mt-5 w-full bg-[#B61913] hover:bg-[#9e1611]"
            disabled={Boolean(missingRequiredGroup)}
            loading={submitting}
            onClick={handleConfirm}
          >
            {submitting
              ? "Adding..."
              : `Add to cart · ${formatNaira(koboOf(totalKobo))}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
