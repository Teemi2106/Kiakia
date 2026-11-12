// app/(customer)/checkout/_components/AddressSection.tsx
"use client";

import { MapPin, Edit2, LocateFixed, Plus, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@kiakia/ui";
import type { LatLng } from "@kiakia/domain";
import { useCustomerStore } from "@/lib/customer/CustomerStoreProvider";
import { StateSelect } from "@/app/_components/StateSelect";
import { useDeviceLocation } from "@/lib/geo/useDeviceLocation";
import type { AddressSearchResult } from "@/lib/geo/search-addresses";
import { createClient } from "@/lib/supabase/client";
import { AddressSearch } from "./AddressSearch";
import { CheckoutMapArea } from "./CheckoutMapArea";
import type { Address } from "./types";

interface AddressSectionProps {
  address: Address | null;
  addresses: Address[];
  onAddressChange: (address: Address) => void;
  vendorLocation: LatLng | null;
  variant?: "desktop" | "mobile";
}

export function AddressSection({
  address,
  addresses,
  onAddressChange,
  vendorLocation,
  variant = "desktop",
}: AddressSectionProps) {
  const router = useRouter();
  const userId = useCustomerStore((s) => s.userId);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [updatingAddressLocation, setUpdatingAddressLocation] = useState(false);
  const [resetMapRequestId, setResetMapRequestId] = useState(0);
  const [searchResult, setSearchResult] = useState<AddressSearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showMap] = useState(true);
  const [newAddress, setNewAddress] = useState({
    label: "Home",
    line1: "",
    landmark: "",
    city: "Abuja",
    state: "FCT",
  });

  // Coordinates fill the addresses.location geography column (required, NOT
  // NULL). The reverse-geocoded state/city are prefilled too, so the customer
  // normally only confirms them; the street is suggested only if still empty.
  // Requested automatically as soon as the "add address" form opens.
  const {
    locate: useMyLocation,
    locating,
    error: locationError,
  } = useDeviceLocation({
    auto: isAddingNew,
    onFound: (found, resolved) => {
      setCoords(found);
      setSearchResult(null);
      setNewAddress((current) => ({
        ...current,
        state: resolved?.state ?? current.state,
        city: resolved?.city ?? current.city,
        line1: current.line1 || resolved?.line1 || "",
      }));
    },
  });

  function selectSearchResult(result: AddressSearchResult) {
    setCoords(result.point);
    setSearchResult(result);
    setNewAddress((current) => ({
      ...current,
      line1: result.line1,
      city: result.city || current.city,
      state: result.state ?? current.state,
    }));
    setSaveError(null);
  }

  const handleSaveAddress = async () => {
    if (!newAddress.line1 || !coords) {
      setSaveError(
        "Add your address and share your location before saving.",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);

    // location is geography(point,4326): PostGIS WKT is lng-then-lat.
    const { data: savedAddress, error: insertError } = await createClient()
      .from("addresses")
      .insert({
        customer_id: userId,
        label: newAddress.label,
        line1: newAddress.line1,
        landmark: newAddress.landmark || null,
        city: newAddress.city,
        state: newAddress.state,
        location: `POINT(${coords.lng} ${coords.lat})`,
      })
      .select(
        "id, label, line1, landmark, city, state, is_default, location_lat, location_lng",
      )
      .single();

    setSaving(false);

    if (insertError || !savedAddress) {
      setSaveError("Could not save this address. Please try again.");
      return;
    }

    onAddressChange(savedAddress);
    setIsAddingNew(false);
    setNewAddress({
      label: "Home",
      line1: "",
      landmark: "",
      city: "Abuja",
      state: "FCT",
    });
    setCoords(null);
    setSearchResult(null);
    router.refresh();
  };

  const handleUpdateAddressLocation = async () => {
    if (!address || !coords) return;
    setUpdatingAddressLocation(true);
    setSaveError(null);
    const { data: updatedAddress, error } = await createClient()
      .from("addresses")
      .update({
        location: `POINT(${coords.lng} ${coords.lat})`,
        ...(searchResult ? {
          line1: searchResult.line1,
          city: searchResult.city || address.city,
          state: searchResult.state ?? address.state,
        } : {}),
      })
      .eq("id", address.id)
      .eq("customer_id", userId)
      .select("id, label, line1, landmark, city, state, is_default, location_lat, location_lng")
      .single();
    setUpdatingAddressLocation(false);

    if (error || !updatedAddress) {
      setSaveError("Could not update this address location. Please try again.");
      return;
    }

    onAddressChange(updatedAddress);
    setCoords(null);
    setSearchResult(null);
    router.refresh();
  };

  const isMobile = variant === "mobile";

  // If no address and not adding new, show the "Add address" prompt
  if (!address && !isAddingNew) {
    return (
      <div className={isMobile ? "space-y-4" : "space-y-6"}>
        <div className="rounded-xl border border-dashed border-kk-line bg-kk-cream p-6 text-center">
          <MapPin className="mx-auto size-8 text-kk-cocoa/40" />
          <p className="mt-2 font-inter text-sm text-kk-cocoa">
            No address selected
          </p>
          <button
            type="button"
            onClick={() => setIsAddingNew(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-kk-red px-4 py-2 text-sm font-semibold text-white hover:bg-kk-red-hover"
          >
            <Plus className="size-4" />
            Add new address
          </button>
        </div>
        <AddressSearch
          onSelect={(result) => {
            selectSearchResult(result);
            setIsAddingNew(true);
          }}
        />
        {addresses.length > 0 && (
          <div className="space-y-2">
            <p className="font-inter text-xs font-medium text-kk-cocoa">
              Or select a saved address
            </p>
            {addresses.map((addr) => (
              <button
                type="button"
                key={addr.id}
                onClick={() => onAddressChange(addr)}
                className="w-full rounded-xl border border-kk-hair p-3 text-left transition-colors hover:border-kk-red"
              >
                <p className="font-inter text-sm font-medium text-kk-ink">
                  {addr.label || "Address"}
                  {addr.is_default && (
                    <span className="ml-2 text-xs text-kk-red-ink">Default</span>
                  )}
                </p>
                <p className="font-inter text-xs text-kk-cocoa">
                  {addr.line1}, {addr.city}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Show the address input form
  if (isAddingNew) {
    return (
      <div className={isMobile ? "space-y-4" : "space-y-6"}>
        <div className="flex items-center justify-between">
          <h3 className="font-inter text-sm font-semibold text-kk-ink">
            Add New Address
          </h3>
          <button
            type="button"
            onClick={() => setIsAddingNew(false)}
            className="rounded-full p-1 hover:bg-black/5"
          >
            <X className="size-4 text-kk-cocoa" />
          </button>
        </div>

        <AddressSearch onSelect={selectSearchResult} />

        <div className="space-y-3">
          <div>
            <label className="font-inter text-xs font-medium text-kk-cocoa">
              Label
            </label>
            <select
              value={newAddress.label}
              onChange={(e) =>
                setNewAddress({ ...newAddress, label: e.target.value })
              }
              className="mt-1 w-full rounded-xl border border-kk-hair bg-kk-sand px-4 py-2.5 font-inter text-sm text-kk-ink focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
            >
              <option value="Home">Home</option>
              <option value="Office">Office</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="font-inter text-xs font-medium text-kk-cocoa">
              Address
            </label>
            <Input
              placeholder="Enter your street address"
              value={newAddress.line1}
              onChange={(e) =>
                setNewAddress({ ...newAddress, line1: e.target.value })
              }
              className="mt-1 w-full"
            />
          </div>

          <div>
            <label className="font-inter text-xs font-medium text-kk-cocoa">
              Landmark (optional)
            </label>
            <Input
              placeholder="Near a famous landmark..."
              value={newAddress.landmark}
              onChange={(e) =>
                setNewAddress({ ...newAddress, landmark: e.target.value })
              }
              className="mt-1 w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-inter text-xs font-medium text-kk-cocoa">
                City
              </label>
              <Input
                value={newAddress.city}
                onChange={(e) =>
                  setNewAddress({ ...newAddress, city: e.target.value })
                }
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="font-inter text-xs font-medium text-kk-cocoa">
                State
              </label>
              <StateSelect
                value={newAddress.state}
                onChange={(state) => setNewAddress({ ...newAddress, state })}
                className="mt-1"
              />
            </div>
          </div>

          {/* Location Button */}
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-kk-hair bg-kk-sand px-4 py-3 text-sm font-medium text-kk-cocoa hover:border-kk-red disabled:opacity-50"
          >
            <LocateFixed className="size-4" />
            {locating
              ? "Locating..."
              : coords
                ? "Location captured ✓"
                : "Use my current location"}
          </button>
          {locationError && (
            <p className="text-xs text-danger">{locationError}</p>
          )}
          {coords && (
            <CheckoutMapArea vendor={vendorLocation} destination={coords} />
          )}

          {saveError && <p className="text-xs text-danger">{saveError}</p>}

          {/* Save/Cancel Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => void handleSaveAddress()}
              disabled={!newAddress.line1 || !coords || saving}
              className="flex-1 rounded-xl bg-kk-red px-4 py-2.5 font-inter text-sm font-semibold text-white hover:bg-kk-red-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Address"}
            </button>
            <button
              type="button"
              onClick={() => setIsAddingNew(false)}
              disabled={saving}
              className="flex-1 rounded-xl border border-kk-hair px-4 py-2.5 font-inter text-sm font-medium text-kk-cocoa hover:bg-kk-sand disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

    );
  }

  // Show the selected address
  return (
    <div className={isMobile ? "space-y-4" : "space-y-6"}>
      {/* Address Display */}
      <div className="flex items-start gap-4 rounded-xl border border-kk-hair bg-kk-sand p-4">
        <div className="rounded-lg bg-kk-hair p-2">
          <MapPin className="size-5 text-kk-red-ink" />
        </div>
        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-kk-ink">
            {address?.label || "Address"}
          </p>
          <p className="font-inter text-sm text-kk-cocoa">
            {address?.line1}
            {address?.landmark ? `, near ${address.landmark}` : ""}
          </p>
          <p className="font-inter text-sm text-kk-cocoa">
            {address?.city}, {address?.state}
          </p>
          {address?.is_default && (
            <span className="mt-1 inline-block text-xs font-medium text-kk-red-ink">
              Default
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsAddingNew(true)}
          className="rounded-full p-2 hover:bg-black/5"
        >
          <Edit2 className="size-4 text-kk-cocoa" />
        </button>
      </div>

      {/* Map: vendor pin, delivery pin, and the distance between them */}
      <AddressSearch onSelect={selectSearchResult} />
      {showMap && (
        <CheckoutMapArea
          vendor={vendorLocation}
          destination={
            coords ?? (address?.location_lat != null && address?.location_lng != null
              ? { lat: address.location_lat, lng: address.location_lng }
              : null)
          }
          onDestinationChange={setCoords}
          resetViewRequestId={resetMapRequestId}
        />
      )}

      {/* Change Address (if multiple) */}
      {addresses.length > 1 && (
        <div className="space-y-2">
          <p className="font-inter text-xs font-medium text-kk-cocoa">
            Saved addresses
          </p>
          {addresses.map((addr) => (
            <button
              type="button"
              key={addr.id}
              onClick={() => onAddressChange(addr)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                addr.id === address?.id
                  ? "border-kk-red bg-[rgba(182,25,19,0.05)]"
                  : "border-kk-hair hover:border-kk-red"
              }`}
            >
              <p className="font-inter text-sm font-medium text-kk-ink">
                {addr.label || "Address"}
                {addr.is_default && (
                  <span className="ml-2 text-xs text-kk-red-ink">Default</span>
                )}
              </p>
              <p className="font-inter text-xs text-kk-cocoa">
                {addr.line1}, {addr.city}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Add New Address Button */}
      <button
        type="button"
        onClick={() => setIsAddingNew(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-kk-line py-3 text-sm font-medium text-kk-cocoa hover:border-kk-red hover:text-kk-red-ink"
      >
        <Plus className="size-4" />
        Add new address
      </button>

      {/* Location Button (if address selected) */}
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-kk-hair px-4 py-3 text-sm font-medium text-kk-cocoa hover:border-kk-red disabled:opacity-50"
      >
        <LocateFixed className="size-4" />
        {locating
          ? "Locating..."
          : coords
            ? "Update with current location"
            : "Use my current location"}
      </button>
      {coords && address && (
        <div className="space-y-2">
          <p className="text-center font-inter text-xs text-kk-cocoa">
            The pin is at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}. Drag it to adjust the exact spot.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setCoords(null);
                setSearchResult(null);
                setResetMapRequestId((id) => id + 1);
              }}
              className="flex-1 rounded-xl border border-kk-hair px-4 py-3 text-sm font-semibold text-kk-cocoa hover:bg-kk-sand"
            >
              Keep saved location
            </button>
            <button
              type="button"
              onClick={() => void handleUpdateAddressLocation()}
              disabled={updatingAddressLocation}
              className="flex-1 rounded-xl bg-kk-red px-4 py-3 text-sm font-semibold text-white hover:bg-kk-red-hover disabled:opacity-50"
            >
              {updatingAddressLocation ? "Saving location…" : "Save new location"}
            </button>
          </div>
        </div>
      )}
      {saveError && <p className="text-xs text-danger">{saveError}</p>}
      {locationError && <p className="text-xs text-danger">{locationError}</p>}
    </div>
  );
}
