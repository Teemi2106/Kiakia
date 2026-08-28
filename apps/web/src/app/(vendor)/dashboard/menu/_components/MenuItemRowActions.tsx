"use client";

import {
  deleteMenuItemAction,
  toggleItemAvailabilityAction,
} from "@/app/actions/menu";
import { Loader2, Trash2 } from "lucide-react";
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
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B61913]/40 focus-visible:ring-offset-1 ${
        checked ? "border-[#176A22] bg-[#176A22]" : "border-[#E4BEB8] bg-[#E5E2E1]"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-200 ${checked ? "translate-x-6" : "translate-x-1"}`}
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
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    try {
      await deleteMenuItemAction(vendorId, itemId);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDelete()}
      disabled={pending}
      className="rounded-lg p-2 text-[#5B403C] transition-colors hover:bg-[#FFDAD5] hover:text-[#BA1A1A] disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Delete item"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </button>
  );
}
