"use client";

import { Button, EmptyState, Input } from "@kiakia/ui";
import { LocateFixed, MapPin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

export function AddressList({ addresses }: { addresses: readonly Address[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function remove(id: string) {
    setRemovingId(id);
    const supabase = createClient();
    await supabase.from("addresses").delete().eq("id", id);
    router.refresh();
    setRemovingId(null);
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {addresses.length === 0 && !adding && (
        <EmptyState
          title="No saved addresses yet"
          description="Add a delivery address so checkout remembers where to send your orders."
          action={
            <Button
              onClick={() => setAdding(true)}
              className="rounded-xl bg-[#B61913] px-5 font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
            >
              <Plus className="size-4" />
              Add address
            </Button>
          }
        />
      )}

      {addresses.map((address) => (
        <div
          key={address.id}
          className="flex items-start justify-between gap-3 rounded-2xl border border-[#E5E2E1] bg-white p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#F6F3F2]">
              <MapPin className="size-5 text-[#B61913]" />
            </div>
            <div>
              <p className="flex items-center gap-2 font-inter text-sm font-semibold text-[#1C1B1B]">
                {address.label ?? "Address"}
                {address.is_default && (
                  <span className="rounded-full bg-[#FFDCC5] px-2 py-0.5 font-inter text-[11px] font-semibold text-[#934B00]">
                    Default
                  </span>
                )}
              </p>
              <p className="mt-0.5 font-inter text-sm text-[#5B403C]">
                {address.line1}
                {address.landmark ? `, near ${address.landmark}` : ""}, {address.city}, {address.state}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={removingId === address.id}
            onClick={() => void remove(address.id)}
            className="shrink-0 rounded-full p-2 text-[#5B403C] transition-colors hover:bg-[#FCF9F8] hover:text-[#BA1A1A] disabled:opacity-40"
            aria-label="Remove address"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <NewAddressForm
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        addresses.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[#E4BEB8] bg-white py-4 font-inter text-sm font-semibold text-[#B61913] transition-colors hover:bg-[#FCF9F8]"
          >
            <Plus className="size-4" />
            Add new address
          </button>
        )
      )}
    </div>
  );
}

function NewAddressForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState("Home");
  const [line1, setLine1] = useState("");
  const [landmark, setLandmark] = useState("");
  const [city, setCity] = useState("Abuja");
  const [state, setState] = useState("FCT");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Please enable location access.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function save() {
    if (!line1 || !coords) {
      setError("Add your address and share your location before saving.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error: insertError } = await supabase.from("addresses").insert({
      customer_id: user.id,
      label,
      line1,
      landmark: landmark || null,
      city,
      state,
      location: `POINT(${coords.lng} ${coords.lat})`,
    });

    setSaving(false);
    if (insertError) {
      setError("Could not save this address.");
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-2xl border border-[#E5E2E1] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Label</label>
          <Input
            placeholder="Label (e.g. Home, Office)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Address</label>
          <Input
            placeholder="Address"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
          />
        </div>
        <div>
          <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">
            Landmark (optional)
          </label>
          <Input
            placeholder="Landmark (optional)"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">City</label>
            <Input
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
            />
          </div>
          <div>
            <label className="font-inter text-xs font-semibold uppercase tracking-wide text-[#5B403C]">State</label>
            <Input
              placeholder="State"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="mt-1.5 w-full rounded-xl border-[#E5E2E1] font-inter text-sm text-[#1C1B1B] focus:border-[#B61913]"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-2 self-start rounded-xl border border-[#E4BEB8] px-3 py-2 font-inter text-sm font-medium text-[#1C1B1B] transition-colors hover:border-[#B61913] hover:text-[#B61913] disabled:opacity-50"
        >
          <LocateFixed className="size-4" />
          {locating ? "Locating…" : coords ? "Location captured" : "Use my current location"}
        </button>
        {error && <p className="font-inter text-xs font-medium text-[#BA1A1A]">{error}</p>}
        <div className="flex gap-2">
          <Button
            onClick={() => void save()}
            loading={saving}
            className="flex-1 rounded-xl bg-[#B61913] font-inter text-sm font-semibold text-white hover:bg-[#9A1410]"
          >
            Save address
          </Button>
          <Button
            variant="secondary"
            onClick={onCancel}
            type="button"
            className="rounded-xl border border-[#E5E2E1] bg-white font-inter text-sm font-semibold text-[#5B403C] hover:bg-[#FCF9F8]"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
