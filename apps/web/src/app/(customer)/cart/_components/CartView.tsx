"use client";

import { formatNaira, koboOf } from "@kiakia/domain";
import { Button } from "@kiakia/ui";
import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeCartItem, updateCartItemQty } from "@/lib/cart";

interface CartItemRow {
  readonly id: string;
  readonly name_snapshot: string;
  readonly unit_price_kobo: number;
  readonly qty: number;
  readonly line_total_kobo: number;
}

export function CartView({ items }: { items: readonly CartItemRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function changeQty(id: string, qty: number) {
    setPendingId(id);
    await updateCartItemQty(id, qty);
    router.refresh();
    setPendingId(null);
  }

  async function remove(id: string) {
    setPendingId(id);
    await removeCartItem(id);
    router.refresh();
    setPendingId(null);
  }

  const totalKobo = items.reduce((sum, item) => sum + item.line_total_kobo, 0);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-card border border-border bg-surface-raised p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{item.name_snapshot}</p>
            <p className="text-sm text-ink-muted">{formatNaira(koboOf(item.unit_price_kobo))} each</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pendingId === item.id}
              onClick={() => void changeQty(item.id, item.qty - 1)}
              className="flex size-7 items-center justify-center rounded-full border border-border text-ink disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-4 text-center text-sm">{item.qty}</span>
            <button
              type="button"
              disabled={pendingId === item.id}
              onClick={() => void changeQty(item.id, item.qty + 1)}
              className="flex size-7 items-center justify-center rounded-full border border-border text-ink disabled:opacity-40"
              aria-label="Increase quantity"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <p className="w-20 shrink-0 text-right text-sm font-medium text-ink">
            {formatNaira(koboOf(item.line_total_kobo))}
          </p>
          <button
            type="button"
            disabled={pendingId === item.id}
            onClick={() => void remove(item.id)}
            className="text-ink-muted hover:text-danger disabled:opacity-40"
            aria-label={`Remove ${item.name_snapshot}`}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-base font-semibold text-ink">
        <span>Subtotal</span>
        <span>{formatNaira(koboOf(totalKobo))}</span>
      </div>
      <p className="text-xs text-ink-muted">Delivery and service fees are calculated at checkout.</p>

      <Link href="/checkout">
        <Button className="mt-2 w-full">Proceed to Checkout →</Button>
      </Link>
    </div>
  );
}
