"use client";

import { LocateFixed, MapPin, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AddressSearch } from "@/app/(customer)/checkout/_components/AddressSearch";
import { AddressPreviewMap } from "./AddressPreviewMap";
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-kk-ink/55 p-3 backdrop-blur-[3px] sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-location-title"
            aria-describedby="delivery-location-description"
            className="relative max-h-[min(88dvh,760px)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/70 bg-[radial-gradient(ellipse_at_top_right,rgba(255,215,173,0.35),transparent_45%),linear-gradient(145deg,#fffdfa_0%,#ffffff_52%,#fff9f4_100%)] p-5 shadow-[0_32px_100px_-30px_rgba(29,21,18,0.55)] sm:p-8 md:p-10"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close delivery location picker"
              className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full border border-kk-line/60 bg-white/80 text-kk-cocoa shadow-sm transition hover:rotate-90 hover:bg-white hover:text-kk-ink sm:right-6 sm:top-6"
            >
              <X className="size-5" />
            </button>

            <div className="mb-7 flex items-start gap-4 pr-12 sm:mb-8">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-kk-red to-orange-500 text-white shadow-[0_10px_24px_-12px_rgba(190,32,26,0.75)] sm:size-14">
                <MapPin className="size-6 sm:size-7" />
              </span>
              <div>
                <p className="mb-1 font-inter text-[11px] font-bold uppercase tracking-[0.18em] text-kk-red-ink">Delivery made easy</p>
                <h2 id="delivery-location-title" className="font-sora text-2xl font-bold tracking-tight text-kk-ink sm:text-3xl">Where should we bring your order?</h2>
                <p id="delivery-location-description" className="mt-2 max-w-lg font-inter text-sm leading-6 text-kk-cocoa">Choose an area or share your location so we can find the right delivery options for you.</p>
              </div>
            </div>

            <AddressSearch onSelect={chooseResult} />

            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-kk-line/55 bg-white/70 px-4 py-3.5 text-left transition hover:border-kk-red/25 hover:bg-white hover:shadow-sm disabled:opacity-60"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kk-red/10 text-kk-red-ink">
                <LocateFixed className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-inter text-sm font-semibold text-kk-ink">{locating ? "Finding your location…" : "Use your current location"}</span>
                <span className="mt-0.5 block font-inter text-xs text-kk-cocoa/75">Quickly set your delivery spot from your device</span>
              </span>
            </button>
            {locationError && <p role="status" className="mt-2 px-2 text-xs text-kk-danger-ink">{locationError}</p>}

            {location && (
              <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-kk-red/15 bg-white/85 shadow-[0_16px_40px_-28px_rgba(190,32,26,0.5)]">
                <div className="flex items-start gap-3 p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red-ink"><MapPin className="size-4" /></span>
                  <div className="min-w-0">
                    <p className="font-inter text-[10px] font-bold uppercase tracking-[0.14em] text-kk-red-ink">Your selected area</p>
                    <p className="mt-1 font-inter text-sm font-semibold leading-5 text-kk-ink">{location.label}</p>
                  </div>
                </div>
                <div className="h-56 overflow-hidden border-t border-kk-line/50 sm:h-64">
                  <AddressPreviewMap
                    point={{ lat: location.lat, lng: location.lng }}
                    onChange={(point) => setLocation((current) => current ? { ...current, ...point } : current)}
                  />
                </div>
                <p className="bg-kk-cream/70 px-4 py-2.5 font-inter text-xs text-kk-cocoa">Drag the pin or tap the map to fine-tune your delivery spot.</p>
              </div>
            )}
            {saveError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-kk-danger-ink">{saveError}</p>}

            <button
              type="button"
              onClick={() => void saveLocation()}
              disabled={!location || saving}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-kk-red to-[#d52d22] px-5 py-4 font-inter text-sm font-bold text-white shadow-[0_14px_30px_-16px_rgba(190,32,26,0.8)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-16px_rgba(190,32,26,0.8)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:from-kk-red/45 disabled:to-kk-red/45 disabled:shadow-none"
            >
              {saving ? "Saving…" : "Set delivery location"}
            </button>
            {!location ? <p className="mt-3 text-center font-inter text-xs text-kk-cocoa/70">Pick a search result or use your current location to continue.</p> : null}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
