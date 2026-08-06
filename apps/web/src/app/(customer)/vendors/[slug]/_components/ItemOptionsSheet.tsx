"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { useMemo, useState } from "react";
import type { MenuItem } from "./types";

export function ItemOptionsSheet({
  item,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (selectedOptionIds: readonly string[], qty: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);

  const totalKobo = useMemo(() => {
    const optionsTotal = item.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => selected.has(o.id))
      .reduce((sum, o) => sum + o.priceDeltaKobo, 0);
    return (item.priceKobo + optionsTotal) * qty;
  }, [item, selected, qty]);

  function toggleOption(group: MenuItem["optionGroups"][number], optionId: string) {
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

      const currentInGroup = [...next].filter((id) => groupOptionIds.has(id)).length;
      if (currentInGroup >= group.maxSelect) return prev; // at the cap, ignore
      next.add(optionId);
      return next;
    });
  }

  const missingRequiredGroup = item.optionGroups.find((group) => {
    if (!group.isRequired) return false;
    const chosenInGroup = group.options.filter((o) => selected.has(o.id)).length;
    return chosenInGroup < group.minSelect;
  });

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface-raised p-5 sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink">{item.name}</h2>
        {item.description && <p className="mt-1 text-sm text-ink-muted">{item.description}</p>}

        {item.optionGroups.map((group) => (
          <fieldset key={group.id} className="mt-4">
            <legend className="text-sm font-medium text-ink">
              {group.name}
              {group.isRequired && <span className="text-danger"> *</span>}
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              {group.options.map((option) => (
                <label
                  key={option.id}
                  className="flex items-center justify-between rounded-control border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type={group.maxSelect === 1 ? "radio" : "checkbox"}
                      name={group.id}
                      checked={selected.has(option.id)}
                      disabled={!option.isAvailable}
                      onChange={() => toggleOption(group, option.id)}
                    />
                    {option.name}
                  </span>
                  {option.priceDeltaKobo > 0 && (
                    <span className="text-ink-muted">+{formatNaira(koboOf(option.priceDeltaKobo))}</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Quantity</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="flex size-8 items-center justify-center rounded-full border border-border text-ink"
            >
              −
            </button>
            <span className="w-4 text-center text-sm">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="flex size-8 items-center justify-center rounded-full border border-border text-ink"
            >
              +
            </button>
          </div>
        </div>

        <Button
          className="mt-5 w-full"
          disabled={Boolean(missingRequiredGroup)}
          onClick={() => onConfirm([...selected], qty)}
        >
          Add to cart · {formatNaira(koboOf(totalKobo))}
        </Button>
      </div>
    </div>
  );
}
