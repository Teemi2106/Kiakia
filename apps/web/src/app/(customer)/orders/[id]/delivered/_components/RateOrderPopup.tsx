// app/(customer)/orders/[id]/delivered/_components/RateOrderPopup.tsx
"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import { Button, Textarea } from "@kiakia/ui";
import { createClient } from "@/lib/supabase/client";

interface RateOrderPopupProps {
  orderId: string;
  vendorName: string;
  /** No rider section at all when the order genuinely had none. */
  riderId: string | null;
  riderName: string | null;
}

function StarPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (rating: number) => void;
  label: string;
}) {
  return (
    <div>
      <p className="font-inter text-sm font-medium text-[#1C1B1B]">{label}</p>
      <div className="mt-1.5 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-pressed={value >= star}
            onClick={() => onChange(star)}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            <Star
              className="size-7"
              fill={value >= star ? "#B61913" : "transparent"}
              stroke={value >= star ? "#B61913" : "#DCD9D9"}
              strokeWidth={1.5}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A one-time prompt shown on the "Order Delivered" screen — the moment the
 * customer actually has their meal in hand. Rendered by the delivered page
 * only when order_ratings has no row for this order yet (0073_order_ratings.sql);
 * "Maybe later" just closes it for this page view (no dismissal is
 * persisted anywhere — the customer will simply see it again if they
 * revisit this screen without having submitted a rating).
 */
export function RateOrderPopup({ orderId, vendorName, riderId, riderName }: RateOrderPopupProps) {
  const [dismissed, setDismissed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [vendorRating, setVendorRating] = useState(0);
  const [vendorComment, setVendorComment] = useState("");
  const [riderRating, setRiderRating] = useState(0);
  const [riderComment, setRiderComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;

  async function handleSubmit() {
    if (vendorRating === 0) {
      setError("Rate the vendor to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_order_rating", {
      p_order_id: orderId,
      p_vendor_rating: vendorRating,
      p_vendor_comment: vendorComment.trim() || null,
      p_rider_rating: riderId && riderRating > 0 ? riderRating : null,
      p_rider_comment: riderId && riderRating > 0 ? riderComment.trim() || null : null,
    });

    setSubmitting(false);
    if (rpcError) {
      console.error("RateOrderPopup: submit_order_rating failed", rpcError);
      setError("We couldn't save your rating. Please try again.");
      return;
    }
    setSubmitted(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Rate your order"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {submitted ? (
          <div className="py-6 text-center">
            <p className="font-sora text-xl font-semibold text-[#1C1B1B]">Thanks for the feedback!</p>
            <p className="mt-2 font-inter text-sm text-[#5B403C]">It helps other customers, and helps us too.</p>
            <Button className="mt-6 w-full" onClick={() => setDismissed(true)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-sora text-xl font-semibold text-[#1C1B1B]">How was your order?</h2>
                <p className="mt-1 font-inter text-sm text-[#5B403C]">Your feedback goes straight to {vendorName}.</p>
              </div>
              <button
                type="button"
                aria-label="Maybe later"
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded-full p-1.5 text-[#5B403C] hover:bg-black/5"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <StarPicker value={vendorRating} onChange={setVendorRating} label={`Rate ${vendorName}`} />
              <Textarea
                value={vendorComment}
                onChange={(e) => setVendorComment(e.target.value)}
                rows={2}
                placeholder="What did you think of the food? (optional)"
              />

              {riderId && (
                <>
                  <StarPicker
                    value={riderRating}
                    onChange={setRiderRating}
                    label={`Rate ${riderName ?? "your rider"}`}
                  />
                  <Textarea
                    value={riderComment}
                    onChange={(e) => setRiderComment(e.target.value)}
                    rows={2}
                    placeholder="How was the delivery? (optional)"
                  />
                </>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-[#BA1A1A]">{error}</p>}

            <div className="mt-6 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setDismissed(true)} disabled={submitting}>
                Maybe later
              </Button>
              <Button className="flex-1" onClick={() => void handleSubmit()} loading={submitting}>
                Submit
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
