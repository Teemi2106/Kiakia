"use client";

import { cn } from "@kiakia/ui";
import { useRef, useState, useTransition } from "react";
import { setMessagePreferencesAction } from "@/app/actions/message-preferences";

type Prefs = { marketingEmail: boolean; marketingSms: boolean };

/**
 * Promotion choices for a signed-in customer or vendor. Both default to off.
 * Each switch moves at once and settles behind it; if the save fails it goes
 * back and says so. Saves are sent one after another so a quick second tap
 * cannot be overwritten by an older, slower one.
 */
export function MarketingPreferences({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const saved = useRef<Prefs>(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setError(null);
    startTransition(() => {
      queue.current = queue.current.then(async () => {
        // Built when this turn comes, from what the server last confirmed, so an earlier failed change is never saved by accident.
        const toSave = { ...saved.current, [key]: next[key] };
        const result = await setMessagePreferencesAction(toSave.marketingEmail, toSave.marketingSms).catch(() => ({ error: "failed" }));
        if (result.error) {
          // Roll back only the switch that failed, to the last value the server confirmed.
          setPrefs((current) => ({ ...current, [key]: saved.current[key] }));
          setError("We could not save that change. It has been put back, so please try again.");
          return;
        }
        saved.current = toSave;
      });
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm" aria-labelledby="promotions-heading">
      <h2 id="promotions-heading" className="font-sora text-lg font-semibold text-[#1C1B1B]">
        Promotions
      </h2>
      <p className="mt-1 font-inter text-sm text-[#5B403C]">
        Offers and news from KiaKia. These are off until you turn them on, and you can change your mind at any time.
      </p>

      <ul className="mt-4 flex flex-col divide-y divide-[#E5E2E1]">
        <Row label="Promotional emails" checked={prefs.marketingEmail} onToggle={() => toggle("marketingEmail")} />
        <Row label="Promotional text messages" checked={prefs.marketingSms} onToggle={() => toggle("marketingSms")} />
      </ul>

      {error && (
        <p role="alert" className="mt-3 font-inter text-xs font-medium text-[#BA1A1A]">
          {error}
        </p>
      )}

      <p className="mt-4 font-inter text-xs text-[#5B403C]">
        Service messages, such as order updates, receipts and security notices, are not optional. You will always get these, because the app cannot work without them.
      </p>
    </section>
  );
}

function Row({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="font-inter text-sm font-medium text-[#1C1B1B]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B61913]",
          checked ? "bg-[#B61913]" : "bg-[#D8C2BE]",
        )}
      >
        <span className={cn("absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
      </button>
    </li>
  );
}
