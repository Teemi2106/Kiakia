"use client";

import {
  deleteMenuItemAction,
  toggleItemAvailabilityAction,
} from "@/app/actions/menu";
import { Trash2 } from "lucide-react";
import { useState } from "react";

interface AvailabilityToggleProps {
  vendorId: string;
  itemId: string;
  initialValue: boolean;
  onToggle?: (isAvailable: boolean) => void;
}

export function AvailabilityToggle({
  vendorId,
  itemId,
  initialValue,
  onToggle,
}: AvailabilityToggleProps) {
  const [checked, setChecked] = useState(initialValue);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const next = !checked;
    setChecked(next);

    // Call the callback if provided
    if (onToggle) {
      onToggle(next);
    }

    try {
      await toggleItemAvailabilityAction(vendorId, itemId, next);
    } catch (error) {
      // Revert on error
      setChecked(checked);
      if (onToggle) {
        onToggle(checked);
      }
      console.error("Failed to toggle availability:", error);
    }
    setPending(false);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={pending}
      onClick={() => void toggle()}
      className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors ${checked ? "bg-positive" : "bg-surface-sunken"} disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function DeleteItemButton({
  vendorId,
  itemId,
}: {
  vendorId: string;
  itemId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void deleteMenuItemAction(vendorId, itemId)}
      className="text-ink-muted hover:text-danger"
      aria-label="Delete item"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
