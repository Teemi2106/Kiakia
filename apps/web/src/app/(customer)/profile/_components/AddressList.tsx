"use client";

import { Button, EmptyState, Input } from "@kiakia/ui";
import { LocateFixed, MapPin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useOptimistic, useState, useTransition } from "react";
import { ActionToast } from "@/app/_components/ActionToast";
import { StateSelect } from "@/app/_components/StateSelect";
import { useDeviceLocation } from "@/lib/geo/useDeviceLocation";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { createClient } from "@/lib/supabase/client";

interface Address {
  readonly id: string;
  readonly label: string | null;
  readonly line1: string;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly is_default: boolean;
}

interface NewAddress {
  readonly label: string;
  readonly line1: string;
  readonly landmark: string;
  readonly city: string;
  readonly state: string;
  readonly coords: { lat: number; lng: number };
}

type AddressChange = { type: "add"; address: Address } | { type: "remove"; id: string };

export function AddressList({ addresses }: { addresses: readonly Address[] }) {
  const router = useRouter();
  const userId = useCustomerStore((s) => s.userId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => setError(null), []);
  const [, startTransition] = useTransition();

  // Both writes show their result at once and settle behind it: useOptimistic
  // falls back to the server's list when the transition ends (after the refresh
  // below), so a failed write puts the list back by itself and the toast says why.
  const [shown, applyChange] = useOptimistic(addresses, (current, change: AddressChange) =>
    change.type === "add" ? [...current, change.address] : current.filter((address) => address.id !== change.id),
  );

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      applyChange({ type: "remove", id });
      const { error: deleteError } = await createClient().from("addresses").delete().eq("id", id);
      if (deleteError) setError("Couldn't remove that address. It has been put back.");
      router.refresh();
    });
  }

  function add(values: NewAddress) {
    setError(null);
    setDraft(null);
    setAdding(false);
    startTransition(async () => {
      applyChange({
        type: "add",
        address: {
          id: `pending-${Date.now()}`,
          label: values.label,
          line1: values.line1,
          landmark: values.landmark || null,
          city: values.city,
          state: values.state,
          is_default: addresses.length === 0,
        },
      });
      const { error: insertError } = await createClient().from("addresses").insert({
        customer_id: userId,
        label: values.label,
        line1: values.line1,
        landmark: values.landmark || null,
        city: values.city,
        state: values.state,
        location: `POINT(${values.coords.lng} ${values.coords.lat})`,
      });
      if (insertError) {
        // Give the form back with what was typed, so nothing has to be re-entered.
        setDraft(values);
        setAdding(true);
        setError("Could not save this address.");
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {shown.length === 0 && !adding && (
        <EmptyState
          title="No saved addresses yet"
          description="Add a delivery address so checkout remembers where to send your orders."
          action={
            <Button
              onClick={() => setAdding(true)}
              className="rounded-xl bg-kk-red px-5 font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
            >
              <Plus className="size-4" />
              Add address
            </Button>
          }
        />
      )}

      {shown.map((address) => (
        <div
          key={address.id}
          className="flex items-start justify-between gap-3 rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-kk-sand">
              <MapPin className="size-5 text-kk-red-ink" />
            </div>
            <div>
              <p className="flex items-center gap-2 font-inter text-sm font-semibold text-kk-ink">
                {address.label ?? "Address"}
                {address.is_default && (
                  <span className="rounded-full bg-notice-surface px-2 py-0.5 font-inter text-[11px] font-semibold text-kk-orange-ink">
                    Default
                  </span>
                )}
              </p>
              <p className="mt-0.5 font-inter text-sm text-kk-cocoa">
                {address.line1}
                {address.landmark ? `, near ${address.landmark}` : ""}, {address.city}, {address.state}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={address.id.startsWith("pending-")}
            onClick={() => remove(address.id)}
            className="shrink-0 rounded-full p-2 text-kk-cocoa transition-colors hover:bg-kk-cream hover:text-kk-danger-ink disabled:opacity-40"
            aria-label="Remove address"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <NewAddressForm draft={draft} onSubmit={add} onCancel={() => setAdding(false)} />
      ) : (
        shown.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-kk-line bg-kk-card py-4 font-inter text-sm font-semibold text-kk-red-ink transition-colors hover:bg-kk-cream"
          >
            <Plus className="size-4" />
            Add new address
          </button>
        )
      )}
      <ActionToast message={error} onDismiss={dismiss} />
    </div>
  );
}

function NewAddressForm({
  draft,
  onSubmit,
  onCancel,
}: {
  draft: NewAddress | null;
  onSubmit: (values: NewAddress) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(draft?.label ?? "Home");
  const [line1, setLine1] = useState(draft?.line1 ?? "");
  const [landmark, setLandmark] = useState(draft?.landmark ?? "");
  const [city, setCity] = useState(draft?.city ?? "Abuja");
  const [state, setState] = useState(draft?.state ?? "FCT");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(draft?.coords ?? null);
  const [error, setError] = useState<string | null>(null);

  // Asked for on open (unless a failed save handed back a draft that already has
  // a position). Fills state/city from where they are; the street is only
  // suggested when they haven't typed one.
  const {
    locate: useMyLocation,
    locating,
    error: locationError,
  } = useDeviceLocation({
    auto: !draft,
    onFound: (found, address) => {
      setCoords(found);
      if (address?.state) setState(address.state);
      if (address?.city) setCity(address.city);
      if (address?.line1) setLine1((current) => current || address.line1 || "");
    },
  });

  function save() {
    if (!line1 || !coords) {
      setError("Add your address and share your location before saving.");
      return;
    }
    onSubmit({ label, line1, landmark, city, state, coords });
  }

  return (
    <div className="rounded-2xl border border-kk-hair bg-kk-card p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">Label</label>
          <Input
            placeholder="Label (e.g. Home, Office)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-kk-hair font-inter text-sm text-kk-ink focus:border-kk-red"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">Address</label>
          <Input
            placeholder="Address"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-kk-hair font-inter text-sm text-kk-ink focus:border-kk-red"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">
            Landmark (optional)
          </label>
          <Input
            placeholder="Landmark (optional)"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-kk-hair font-inter text-sm text-kk-ink focus:border-kk-red"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">City</label>
            <Input
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1.5 w-full rounded-xl border-kk-hair font-inter text-sm text-kk-ink focus:border-kk-red"
            />
          </div>
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-kk-cocoa">State</label>
            <StateSelect
              value={state}
              onChange={setState}
              className="mt-1.5"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-2 self-start rounded-xl border border-kk-line px-3 py-2 font-inter text-sm font-medium text-kk-ink transition-colors hover:border-kk-red hover:text-kk-red-ink disabled:opacity-50"
        >
          <LocateFixed className="size-4" />
          {locating ? "Locating…" : coords ? "Location captured" : "Use my current location"}
        </button>
        {(error ?? locationError) && (
          <p className="font-inter text-xs font-medium text-kk-danger-ink">{error ?? locationError}</p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={save}
            className="flex-1 rounded-xl bg-kk-red font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
          >
            Save address
          </Button>
          <Button
            variant="secondary"
            onClick={onCancel}
            type="button"
            className="rounded-xl border border-kk-hair bg-kk-card font-inter text-sm font-semibold text-kk-cocoa hover:bg-kk-cream"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
