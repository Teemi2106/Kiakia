"use client";

import { LocateFixed, MapPin, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AddressSearch } from "@/app/(customer)/checkout/_components/AddressSearch";
import type { AddressSearchResult } from "@/lib/geo/search-addresses";
import { useDeviceLocation } from "@/lib/geo/useDeviceLocation";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { createClient } from "@/lib/supabase/client";

interface DeliveryLocation {
  lat: number;
  lng: number;
  label: string;
  line1: string;
  city: string;
  state: string;
}

export function AddressPicker({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const userId = useCustomerStore((state) => state.userId);
  const addressLabel = useCustomerStore((state) => state.addressLabel);
  const setAddressLabel = useCustomerStore((state) => state.setAddressLabel);
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { locate, locating, error: locationError } = useDeviceLocation({
    onFound: (point, address) => {
      setLocation({
        ...point,
        label: [address?.line1, address?.city, address?.state].filter(Boolean).join(", ") || "Current location",
        line1: address?.line1 ?? "Current location",
        city: address?.city ?? "",
        state: address?.state ?? "",
      });
      setSaveError(null);
    },
  });

  function chooseResult(result: AddressSearchResult) {
    setLocation({
      ...result.point,
      label: result.label,
      line1: result.line1,
      city: result.city,
      state: result.state ?? "",
    });
    setSaveError(null);
  }

  async function saveLocation() {
    if (!location) return;
    setSaving(true);
    setSaveError(null);
    const label = location.city || location.label;

    if (userId !== "guest") {
      const supabase = createClient();
      const { data: existing, error: readError } = await supabase
        .from("addresses")
        .select("id, state")
        .eq("customer_id", userId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (readError) {
        setSaving(false);
        setSaveError("Could not load your saved address. Please try again.");
        return;
      }

      const values = {
        location: `POINT(${location.lng} ${location.lat})`,
        line1: location.line1,
        city: location.city || label,
        ...(location.state || existing?.state ? { state: location.state || existing?.state } : {}),
      };
      if (!existing && !location.state) {
        setSaving(false);
        setSaveError("We couldn't identify your state. Search for your area to set this location.");
        return;
      }
      const result = existing
        ? await supabase.from("addresses").update(values).eq("id", existing.id).eq("customer_id", userId)
        : await supabase.from("addresses").insert({
            ...values,
            customer_id: userId,
            label: "Home",
            state: location.state!,
            is_default: true,
          });

      if (result.error) {
        setSaving(false);
        setSaveError("Could not save this delivery location. Please try again.");
        return;
      }
    } else {
      const value = encodeURIComponent(JSON.stringify({
        lat: location.lat,
        lng: location.lng,
        city: location.city,
        state: location.state,
        label,
      }));
      document.cookie = `kk_delivery_location=${value}; Path=/; Max-Age=2592000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    }

    setAddressLabel(label);
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact
          ? "flex min-w-0 items-center gap-1.5 text-left"
          : "hidden min-w-0 shrink-0 items-center gap-2 rounded-full border border-kk-line/70 bg-kk-card/70 py-1.5 pl-3 pr-3 transition-colors hover:border-kk-red/40 hover:bg-kk-card lg:flex"}
        title={addressLabel ? `Delivering to ${addressLabel}` : "Set delivery location"}
      >
        <MapPin className="size-4 shrink-0 text-kk-red-ink" />
        <span className="min-w-0 truncate font-inter text-xs font-semibold text-kk-ink">
          {compact ? <>{addressLabel ? "Deliver to " : ""}{addressLabel ?? "Set delivery location"}</> : addressLabel ?? "Set location"}
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-location-title"
            className="relative max-h-[min(82vh,700px)] w-full max-w-xl overflow-y-auto rounded-3xl bg-kk-card p-5 shadow-2xl sm:p-8"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close delivery location picker"
              className="absolute right-4 top-4 rounded-full p-2 text-kk-cocoa hover:bg-kk-sand"
            >
              <X className="size-5" />
            </button>
            <h2 id="delivery-location-title" className="mb-6 pr-10 font-sora text-2xl font-bold text-kk-ink sm:text-3xl">Delivery location</h2>

            <AddressSearch onSelect={chooseResult} />

            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="mt-4 flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left font-inter text-sm font-semibold text-kk-red-ink hover:bg-kk-sand disabled:opacity-60"
            >
              <LocateFixed className="size-5 shrink-0" />
              {locating ? "Finding your location…" : "Use your current location"}
            </button>
            {locationError && <p role="status" className="px-2 text-xs text-kk-danger-ink">{locationError}</p>}

            {location && (
              <div className="mt-4 rounded-xl border border-kk-hair bg-kk-sand p-3">
                <p className="text-xs font-medium text-kk-cocoa">Selected delivery area</p>
                <p className="mt-1 font-inter text-sm font-semibold text-kk-ink">{location.label}</p>
              </div>
            )}
            {saveError && <p role="alert" className="mt-3 text-sm text-kk-danger-ink">{saveError}</p>}

            <button
              type="button"
              onClick={() => void saveLocation()}
              disabled={!location || saving}
              className="mt-5 w-full rounded-xl bg-kk-red px-4 py-3 font-inter text-sm font-semibold text-white hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Set delivery location"}
            </button>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
