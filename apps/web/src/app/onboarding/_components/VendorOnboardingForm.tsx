"use client";

import { registerVendorAction, type FormState } from "@/app/actions/vendor";
import { Button, Input, Select, Textarea } from "@kiakia/ui";
import { LocateFixed } from "lucide-react";
import { useActionState, useState } from "react";

const CATEGORIES = ["African", "Rice", "Soups", "Swallow", "Grills", "Drinks", "Bakery", "Groceries"] as const;

const initialState: FormState = {};

export function VendorOnboardingForm() {
  const [state, formAction, pending] = useActionState(registerVendorAction, initialState);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <label htmlFor="name" className="text-sm font-medium text-ink">
          Store Name
        </label>
        <Input id="name" name="name" required placeholder="e.g. Mama Pat Central" className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="category" className="text-sm font-medium text-ink">
          Category
        </label>
        <Select id="category" name="category" defaultValue={CATEGORIES[0]} className="mt-1 w-full">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="addressLine" className="text-sm font-medium text-ink">
          Store Address
        </label>
        <Input id="addressLine" name="addressLine" required className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="state" className="text-sm font-medium text-ink">
          State
        </label>
        {/* Free-typed, same as the customer address form's State field — customers
            in a different state than this value will never see this store listed. */}
        <Input id="state" name="state" required placeholder="e.g. Oyo" className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="landmark" className="text-sm font-medium text-ink">
          Landmark (optional)
        </label>
        <Input id="landmark" name="landmark" className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="description" className="text-sm font-medium text-ink">
          About your store (optional)
        </label>
        <Textarea id="description" name="description" rows={3} className="mt-1 w-full" />
      </div>

      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="flex items-center gap-2 self-start rounded-control border border-border px-3 py-2 text-sm text-ink hover:border-brand-500 disabled:opacity-50"
      >
        <LocateFixed className="size-4" />
        {locating ? "Locating…" : coords ? "Location captured" : "Use my current location"}
      </button>
      {coords && (
        <>
          <input type="hidden" name="lat" value={coords.lat} />
          <input type="hidden" name="lng" value={coords.lng} />
        </>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" loading={pending} className="mt-1 w-full">
        Create my store →
      </Button>
      <p className="text-center text-xs text-ink-muted">
        Your store goes live immediately — you can start adding menu items right away.
      </p>
    </form>
  );
}
