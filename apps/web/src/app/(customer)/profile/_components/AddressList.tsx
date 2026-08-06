"use client";

import { Button, Card, EmptyState, Input } from "@kiakia/ui";
import { LocateFixed, Trash2 } from "lucide-react";
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
    <div className="mt-3 flex flex-col gap-3">
      {addresses.length === 0 && !adding && <EmptyState title="No saved addresses yet" />}

      {addresses.map((address) => (
        <Card key={address.id} className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-ink">
              {address.label ?? "Address"} {address.is_default && <span className="text-xs text-brand-600">· Default</span>}
            </p>
            <p className="text-sm text-ink-muted">
              {address.line1}
              {address.landmark ? `, near ${address.landmark}` : ""}, {address.city}, {address.state}
            </p>
          </div>
          <button
            type="button"
            disabled={removingId === address.id}
            onClick={() => void remove(address.id)}
            className="text-ink-muted hover:text-danger disabled:opacity-40"
            aria-label="Remove address"
          >
            <Trash2 className="size-4" />
          </button>
        </Card>
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
        <Button variant="secondary" onClick={() => setAdding(true)} className="self-start">
          + Add address
        </Button>
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
    <Card>
      <div className="flex flex-col gap-3">
        <Input placeholder="Label (e.g. Home, Office)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input placeholder="Address" value={line1} onChange={(e) => setLine1(e.target.value)} />
        <Input placeholder="Landmark (optional)" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
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
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={() => void save()} loading={saving} className="flex-1">
            Save address
          </Button>
          <Button variant="secondary" onClick={onCancel} type="button">
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
