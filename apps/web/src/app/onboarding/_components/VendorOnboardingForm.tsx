"use client";

import { registerVendorAction, type FormState } from "@/app/actions/vendor";
import { Button, Input, Select, Textarea } from "@kiakia/ui";
import { VENDOR_CATEGORIES } from "@kiakia/domain";
import { LocateFixed } from "lucide-react";
import { useActionState, useState } from "react";
import { StateSelect } from "@/app/_components/StateSelect";
import { useDeviceLocation } from "@/lib/geo/useDeviceLocation";

const initialState: FormState = {};

export function VendorOnboardingForm() {
  const [state, formAction, pending] = useActionState(registerVendorAction, initialState);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [storeState, setStoreState] = useState("");
  const [addressLine, setAddressLine] = useState("");

  // Asked for as soon as the form opens; fills the state (and a street, if
  // none typed yet) so the vendor usually only has to confirm.
  const {
    locate: useMyLocation,
    locating,
    error: locationError,
  } = useDeviceLocation({
    auto: true,
    onFound: (found, address) => {
      setCoords(found);
      if (address?.state) setStoreState(address.state);
      if (address?.line1) setAddressLine((current) => current || address.line1 || "");
    },
  });

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
        <Select id="category" name="category" defaultValue={VENDOR_CATEGORIES[0]} className="mt-1 w-full">
          {VENDOR_CATEGORIES.map((c) => (
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
        <Input
          id="addressLine"
          name="addressLine"
          required
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          className="mt-1 w-full"
        />
      </div>
      <div>
        <label htmlFor="state" className="text-sm font-medium text-ink">
          State
        </label>
        {/* Picked from the fixed list, same as the customer address forms — customers
            in a different state than this value will never see this store listed. */}
        <StateSelect id="state" name="state" value={storeState} onChange={setStoreState} className="mt-1" />
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
      {locationError && <p className="text-xs text-danger">{locationError}</p>}
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
        We create your store right away, so you can add your menu now. It stays hidden from customers until KiaKia approves it, and it only takes orders once you switch on &ldquo;Accepting orders&rdquo; in Settings. You&apos;ll see the approval status at the top of your dashboard.
      </p>
    </form>
  );
}
