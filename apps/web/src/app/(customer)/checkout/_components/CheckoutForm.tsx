"use client";

import { placeOrderAction, type CheckoutFormState } from "@/app/actions/orders";
import { Button, Input } from "@kiakia/ui";
import { LocateFixed } from "lucide-react";
import { useActionState, useId, useState } from "react";

interface SavedAddress {
  readonly id: string;
  readonly label: string | null;
  readonly line1: string;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly is_default: boolean;
}

const initialState: CheckoutFormState = {};

export function CheckoutForm({ addresses }: { addresses: readonly SavedAddress[] }) {
  const [state, formAction, pending] = useActionState(placeOrderAction, initialState);
  const [mode, setMode] = useState<"saved" | "new">(addresses.length > 0 ? "saved" : "new");
  const [selectedAddressId, setSelectedAddressId] = useState(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const formId = useId();

  function useMyLocation() {
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocationError("Couldn't get your location. Please enable location access and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <div className="rounded-card border border-border bg-surface-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Delivery Address</h2>

        {addresses.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {addresses.map((address) => (
              <label
                key={address.id}
                className="flex items-start gap-2 rounded-control border border-border p-3 text-sm has-[:checked]:border-brand-500"
              >
                <input
                  type="radio"
                  name="addressChoice"
                  checked={mode === "saved" && selectedAddressId === address.id}
                  onChange={() => {
                    setMode("saved");
                    setSelectedAddressId(address.id);
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-ink">{address.label ?? "Address"}</span>
                  <br />
                  <span className="text-ink-muted">
                    {address.line1}
                    {address.landmark ? `, near ${address.landmark}` : ""}, {address.city}, {address.state}
                  </span>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-control border border-border p-3 text-sm has-[:checked]:border-brand-500">
              <input type="radio" name="addressChoice" checked={mode === "new"} onChange={() => setMode("new")} />
              Use a new address
            </label>
          </div>
        )}

        {mode === "saved" && selectedAddressId && (
          <input type="hidden" name="addressId" value={selectedAddressId} />
        )}

        {mode === "new" && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor={`${formId}-line1`} className="text-xs font-medium text-ink">
                Address
              </label>
              <Input id={`${formId}-line1`} name="line1" required className="mt-1 w-full" />
            </div>
            <div>
              <label htmlFor={`${formId}-landmark`} className="text-xs font-medium text-ink">
                Landmark (optional)
              </label>
              <Input id={`${formId}-landmark`} name="landmark" className="mt-1 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${formId}-city`} className="text-xs font-medium text-ink">
                  City
                </label>
                <Input id={`${formId}-city`} name="city" defaultValue="Abuja" className="mt-1 w-full" />
              </div>
              <div>
                <label htmlFor={`${formId}-state`} className="text-xs font-medium text-ink">
                  State
                </label>
                <Input id={`${formId}-state`} name="state" defaultValue="FCT" className="mt-1 w-full" />
              </div>
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

            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" name="saveAddress" defaultChecked />
              Save this address for next time
            </label>
            <input type="hidden" name="label" value="Home" />
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-surface-raised p-4">
        <label htmlFor={`${formId}-note`} className="text-sm font-semibold text-ink">
          Delivery note (optional)
        </label>
        <textarea
          id={`${formId}-note`}
          name="deliveryNote"
          rows={2}
          className="mt-2 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500"
          placeholder="E.g. Gate code, landmark, call on arrival…"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" loading={pending} className="w-full">
        Pay with Monnify →
      </Button>
    </form>
  );
}
