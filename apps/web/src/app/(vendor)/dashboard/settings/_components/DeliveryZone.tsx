// app/(vendor)/dashboard/settings/_components/DeliveryZone.tsx
"use client";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { Info, LocateFixed, Loader2, MapPin, MapPinOff } from "lucide-react";
import { updateVendorLocationAction, updateVendorSettingsAction, type FormState } from "@/app/actions/vendor";
import { clientEnv } from "@/lib/env.client";
import type { VendorSettings } from "./types";
import type { LatLng } from "./DeliveryLocationMap";

// See (customer)/orders/[id]/tracking/_components/MapArea.tsx for why this
// split exists: mapbox-gl touches `window` at import time and cannot be
// server-rendered, so the actual map component only ever loads client-side
// via next/dynamic with ssr:false, from this "use client" wrapper.
const DeliveryLocationMap = dynamic(() => import("./DeliveryLocationMap"), {
  ssr: false,
  loading: () => <MapMessage icon={<Loader2 className="size-5 animate-spin" />} message="Loading map…" />,
});

function MapMessage({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-kk-sand px-6 text-center">
      {icon}
      <span className="font-inter text-sm font-medium text-kk-cocoa">{message}</span>
    </div>
  );
}

const locationInitialState: FormState = {};
const settingsInitialState: FormState = {};

export function DeliveryZone({ vendor }: { vendor: VendorSettings }) {
  const [locationState, submitLocation, locationPending] = useActionState(
    updateVendorLocationAction,
    locationInitialState,
  );
  const [settingsState, submitSettings, settingsPending] = useActionState(
    updateVendorSettingsAction,
    settingsInitialState,
  );

  // Staged locally — the map's job is to let the vendor position a pin
  // before submitting it, not to write on every drag. Starts from whatever
  // the vendor already has saved (null until they've ever set one).
  const [position, setPosition] = useState<LatLng | null>(
    vendor.locationLat !== null && vendor.locationLng !== null
      ? { lat: vendor.locationLat, lng: vendor.locationLng }
      : null,
  );
  const [radiusM, setRadiusM] = useState(vendor.deliveryRadiusM);

  // Most vendors won't know how to find/drag a pin to their exact address —
  // "use my location" gets them a correct pin with one tap. flyToRequestId
  // tells the map to actually pan/zoom there (see DeliveryLocationMap's prop
  // comment); a bare position update wouldn't move the view.
  const [flyToRequestId, setFlyToRequestId] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocateError("Your browser doesn't support location access.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({ lat: result.coords.latitude, lng: result.coords.longitude });
        setFlyToRequestId((id) => id + 1);
        setLocating(false);
      },
      (error) => {
        setLocateError(
          error.code === error.PERMISSION_DENIED
            ? "Location access was denied — you can still drop a pin on the map yourself."
            : "Couldn't get your location. Try again, or drop a pin on the map yourself.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-6">
      {/* Store location */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-sora text-2xl font-semibold text-kk-ink">Store Location</h2>
            <p className="text-sm text-kk-cocoa">
              This pin is the center point customers&apos; delivery distance is measured from.
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-notice-surface">
            <MapPin className="size-5 text-kk-orange-ink" />
          </div>
        </div>

        <div className="relative h-80 w-full overflow-hidden rounded-2xl border border-kk-line sm:h-95">
          {clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
            <>
              <DeliveryLocationMap
                position={position}
                onPositionChange={setPosition}
                flyToRequestId={flyToRequestId}
                radiusM={radiusM}
              />
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full bg-kk-card px-3 py-2 text-xs font-semibold text-kk-ink shadow-lg transition-colors hover:bg-kk-sand disabled:cursor-not-allowed disabled:opacity-70"
              >
                {locating ? (
                  <Loader2 className="size-4 animate-spin text-kk-red-ink" />
                ) : (
                  <LocateFixed className="size-4 text-kk-red-ink" />
                )}
                {locating ? "Locating…" : "Use my location"}
              </button>
            </>
          ) : (
            <MapMessage icon={<MapPinOff className="size-6 text-kk-cocoa" />} message="Map unavailable" />
          )}
        </div>
        {locateError && <p className="mt-2 text-xs text-kk-danger-ink">{locateError}</p>}

        <form
          action={submitLocation}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <input type="hidden" name="vendorId" value={vendor.id} />
          <input type="hidden" name="lat" value={position?.lat ?? ""} />
          <input type="hidden" name="lng" value={position?.lng ?? ""} />

          <p className="text-xs text-kk-cocoa">
            {position
              ? `Pinned at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} — drag the pin or click elsewhere on the map to move it.`
              : "Click anywhere on the map to drop a pin for your store."}
          </p>

          <div className="flex items-center gap-3">
            {locationState.error && <p className="text-sm text-kk-danger-ink">{locationState.error}</p>}
            {locationState.success && <p className="text-sm text-kk-green-ink">Location saved.</p>}
            <button
              type="submit"
              disabled={!position || locationPending}
              className="shrink-0 rounded-xl bg-kk-red px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {locationPending ? "Saving…" : "Save location"}
            </button>
          </div>
        </form>
      </div>

      {/* Delivery & fulfillment settings */}
      <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="font-sora text-2xl font-semibold text-kk-ink">Delivery &amp; Fulfillment</h2>
          <p className="text-sm text-kk-cocoa">
            How far you&apos;ll deliver, your minimum order, and the prep time customers see at checkout.
          </p>
        </div>

        <form action={submitSettings} className="space-y-5">
          <input type="hidden" name="vendorId" value={vendor.id} />
          {/* updateVendorSettingsAction writes every one of these columns from
              whatever's in the FormData, not just the fields a given tab
              renders — resubmit the vendor's current values for everything
              this tab doesn't show so saving here can't blank out the
              General tab's fields (name, banner, etc). */}
          <input type="hidden" name="name" value={vendor.name} />
          <input type="hidden" name="description" value={vendor.description ?? ""} />
          <input type="hidden" name="addressLine" value={vendor.addressLine ?? ""} />
          <input type="hidden" name="landmark" value={vendor.landmark ?? ""} />
          <input type="hidden" name="currentBannerUrl" value={vendor.bannerUrl ?? ""} />
          {vendor.isAcceptingOrders && <input type="hidden" name="isAcceptingOrders" value="on" />}

          <div>
            <label htmlFor="deliveryRadiusM" className="mb-2 block font-inter text-sm font-medium text-kk-ink">
              How far will you deliver?
            </label>
            <input
              id="deliveryRadiusM"
              name="deliveryRadiusM"
              type="range"
              min={500}
              max={20000}
              step={500}
              value={radiusM}
              onChange={(e) => setRadiusM(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-kk-fill accent-kk-red"
            />
            <div className="mt-2 flex justify-between text-sm text-kk-cocoa">
              <span>0.5km</span>
              <span className="font-bold text-kk-red-ink">{(radiusM / 1000).toFixed(1)}km</span>
              <span>20km</span>
            </div>
          </div>

          <div className="rounded-xl border border-[rgba(147,75,0,0.2)] bg-[rgba(255,220,197,0.3)] p-4">
            <div className="flex items-center gap-3 text-kk-orange-darkest">
              <Info className="size-5 shrink-0" />
              <p className="text-sm">
                Customers can order from you only if their delivery address is within this distance of your
                kitchen. The red circle on the map shows the area you cover. A smaller area means shorter
                rides and faster deliveries.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="minOrderNaira" className="mb-2 block font-inter text-sm font-medium text-kk-ink">
                Minimum Order Value
              </label>
              <div className="flex items-center">
                <span className="rounded-l-xl border border-r-0 border-kk-line bg-kk-sand px-3 py-2 font-inter text-sm">
                  ₦
                </span>
                <input
                  id="minOrderNaira"
                  name="minOrderNaira"
                  type="number"
                  min={0}
                  defaultValue={vendor.minOrderKobo / 100}
                  className="w-full rounded-r-xl border border-kk-line p-2 font-inter text-sm focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="avgPrepMins" className="mb-2 block font-inter text-sm font-medium text-kk-ink">
                Average Prep Time
              </label>
              <div className="flex items-center">
                <input
                  id="avgPrepMins"
                  name="avgPrepMins"
                  type="number"
                  min={1}
                  defaultValue={vendor.avgPrepMins}
                  className="w-full rounded-l-xl border border-kk-line p-2 font-inter text-sm focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
                />
                <span className="rounded-r-xl border border-l-0 border-kk-line bg-kk-sand px-3 py-2 font-inter text-sm">
                  min
                </span>
              </div>
            </div>
          </div>

          {settingsState.error && <p className="text-sm text-kk-danger-ink">{settingsState.error}</p>}
          {settingsState.success && <p className="text-sm text-kk-green-ink">Saved.</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={settingsPending}
              className="rounded-xl bg-kk-red px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsPending ? "Saving…" : "Save delivery settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
