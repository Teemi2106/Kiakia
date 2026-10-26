"use client";

import { advanceSelfDeliveryAction, completeSelfDeliveryAction } from "@/app/actions/vendor-delivery";
import { nextSelfDeliveryStep } from "@/lib/vendor/self-delivery";
import { formatNaira, koboOf } from "@kiakia/domain";
import { Button, Input } from "@kiakia/ui";
import { Bike } from "lucide-react";
import { useOptimistic, useState, useTransition, type FormEvent } from "react";

/**
 * The vendor's own delivery, step by step: picked up, on my way, arrived, then
 * the customer's code. Steps are optimistic (the next button shows at once and
 * rolls back if the server refuses); the code check is never optimistic, it
 * waits for the server and shows exactly what happened.
 */
export function SelfDeliveryPanel({ orderId, status, deliveryFeeKobo }: { orderId: string; status: string; deliveryFeeKobo: number }) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<string, string>(status, (_current, next) => next);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);

  const delivered = status === "delivered" || done;
  const step = nextSelfDeliveryStep(shown);

  function advance(to: "picked_up" | "in_transit" | "arrived") {
    setError(null);
    startTransition(async () => {
      setShown(to);
      const result = await advanceSelfDeliveryAction(orderId, to);
      if (!result.ok) setError(result.error ?? "Something went wrong. Please try again.");
    });
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying) return;
    setError(null);
    setVerifying(true);
    try {
      const result = await completeSelfDeliveryAction(orderId, code);
      if (result.ok) setDone(true);
      else {
        setError(result.error ?? "Something went wrong. Please try again.");
        setLocked(result.locked === true);
        setCode("");
      }
    } finally {
      setVerifying(false);
    }
  }

  if (delivered) {
    return (
      <div role="status" className="rounded-2xl border border-[#176A22]/30 bg-[#DFF3DC] p-5">
        <p className="font-sora text-base font-bold text-[#176A22]">Delivered.</p>
        <p className="mt-1 text-sm text-[#1C1B1B]">
          The delivery fee ({formatNaira(koboOf(deliveryFeeKobo))}) is yours, on top of your share of the food.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-inter text-sm font-bold uppercase tracking-wider text-[#1C1B1B]">
        <Bike className="size-4 text-[#5B403C]" aria-hidden="true" />
        You are delivering this order
      </h2>
      <p className="mt-2 text-sm text-[#5B403C]">
        No rider is involved. You keep the delivery fee ({formatNaira(koboOf(deliveryFeeKobo))}) once the customer gives you their code.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {step ? (
          <Button type="button" className="w-full" disabled={pending} onClick={() => advance(step.to)}>
            {step.label}
          </Button>
        ) : shown === "arrived" ? (
          <form onSubmit={(event) => void verify(event)} className="flex flex-col gap-3">
            <label htmlFor="self-delivery-code" className="text-sm font-medium text-[#1C1B1B]">
              Enter the customer&apos;s code to complete
            </label>
            <Input
              id="self-delivery-code"
              name="code"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              required
              disabled={locked || verifying}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" loading={verifying} disabled={locked || verifying || code.length !== 4}>
              Complete delivery
            </Button>
          </form>
        ) : (
          <p className="text-sm text-[#5B403C]">Mark the order ready when the food is done. The delivery steps appear here once it is ready.</p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-[#FFDAD5] px-3 py-2 text-sm text-[#BA1A1A]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
