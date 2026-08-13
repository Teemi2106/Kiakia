// app/(customer)/checkout/_components/AddressSection.tsx
"use client";

import { MapPin, Edit2, LocateFixed, Plus, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@kiakia/ui";
import type { Address } from "./types";

interface AddressSectionProps {
  address: Address | null;
  addresses: Address[];
  onAddressChange: (address: Address) => void;
  variant?: "desktop" | "mobile";
}

export function AddressSection({
  address,
  addresses,
  onAddressChange,
  variant = "desktop",
}: AddressSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [newAddress, setNewAddress] = useState({
    label: "Home",
    line1: "",
    landmark: "",
    city: "Abuja",
    state: "FCT",
  });

  const useMyLocation = () => {
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocating(false);
        // In a real app, you'd reverse geocode these coordinates to get the address
        // and auto-fill the form fields
        console.log("Location captured:", position.coords);
      },
      () => {
        setLocationError(
          "Couldn't get your location. Please enable location access and try again.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleSaveAddress = () => {
    // In a real app, you'd save to Supabase here
    // For now, we'll use the first saved address or create a mock one
    const mockAddress: Address = {
      id: "new-address",
      label: newAddress.label,
      line1: newAddress.line1,
      landmark: newAddress.landmark || null,
      city: newAddress.city,
      state: newAddress.state,
      is_default: false,
    };
    onAddressChange(mockAddress);
    setIsAddingNew(false);
    setNewAddress({
      label: "Home",
      line1: "",
      landmark: "",
      city: "Abuja",
      state: "FCT",
    });
  };

  const isMobile = variant === "mobile";

  // If no address and not adding new, show the "Add address" prompt
  if (!address && !isAddingNew) {
    return (
      <div className={isMobile ? "space-y-4" : "space-y-6"}>
        <div className="rounded-xl border border-dashed border-[#E4BEB8] bg-[#FCF9F8] p-6 text-center">
          <MapPin className="mx-auto size-8 text-[#5B403C]/40" />
          <p className="mt-2 font-inter text-sm text-[#5B403C]">
            No address selected
          </p>
          <button
            onClick={() => setIsAddingNew(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#B61913] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9e1611]"
          >
            <Plus className="size-4" />
            Add new address
          </button>
        </div>
        {addresses.length > 0 && (
          <div className="space-y-2">
            <p className="font-inter text-xs font-medium text-[#5B403C]">
              Or select a saved address
            </p>
            {addresses.map((addr) => (
              <button
                key={addr.id}
                onClick={() => onAddressChange(addr)}
                className="w-full rounded-xl border border-[#E5E2E1] p-3 text-left transition-colors hover:border-[#B61913]"
              >
                <p className="font-inter text-sm font-medium text-[#1C1B1B]">
                  {addr.label || "Address"}
                  {addr.is_default && (
                    <span className="ml-2 text-xs text-[#B61913]">Default</span>
                  )}
                </p>
                <p className="font-inter text-xs text-[#5B403C]">
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
          <h3 className="font-inter text-sm font-semibold text-[#1C1B1B]">
            Add New Address
          </h3>
          <button
            onClick={() => setIsAddingNew(false)}
            className="rounded-full p-1 hover:bg-black/5"
          >
            <X className="size-4 text-[#5B403C]" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="font-inter text-xs font-medium text-[#5B403C]">
              Label
            </label>
            <select
              value={newAddress.label}
              onChange={(e) =>
                setNewAddress({ ...newAddress, label: e.target.value })
              }
              className="mt-1 w-full rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] px-4 py-2.5 font-inter text-sm text-[#1C1B1B] focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
            >
              <option value="Home">Home</option>
              <option value="Office">Office</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="font-inter text-xs font-medium text-[#5B403C]">
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
            <label className="font-inter text-xs font-medium text-[#5B403C]">
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
              <label className="font-inter text-xs font-medium text-[#5B403C]">
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
              <label className="font-inter text-xs font-medium text-[#5B403C]">
                State
              </label>
              <Input
                value={newAddress.state}
                onChange={(e) =>
                  setNewAddress({ ...newAddress, state: e.target.value })
                }
                className="mt-1 w-full"
              />
            </div>
          </div>

          {/* Location Button */}
          <button
            onClick={useMyLocation}
            disabled={locating}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] px-4 py-3 text-sm font-medium text-[#5B403C] hover:border-[#B61913] disabled:opacity-50"
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
            <p className="text-xs text-[#5B403C]">
              📍 Coordinates: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </p>
          )}

          {/* Save/Cancel Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSaveAddress}
              disabled={!newAddress.line1}
              className="flex-1 rounded-xl bg-[#B61913] px-4 py-2.5 font-inter text-sm font-semibold text-white hover:bg-[#9e1611] disabled:opacity-50"
            >
              Save Address
            </button>
            <button
              onClick={() => setIsAddingNew(false)}
              className="flex-1 rounded-xl border border-[#E5E2E1] px-4 py-2.5 font-inter text-sm font-medium text-[#5B403C] hover:bg-[#F6F3F2]"
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
      <div className="flex items-start gap-4 rounded-xl border border-[#E5E2E1] bg-[#F6F3F2] p-4">
        <div className="rounded-lg bg-[#E5E2E1] p-2">
          <MapPin className="size-5 text-[#B61913]" />
        </div>
        <div className="flex-1">
          <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {address?.label || "Address"}
          </p>
          <p className="font-inter text-sm text-[#5B403C]">
            {address?.line1}
            {address?.landmark ? `, near ${address.landmark}` : ""}
          </p>
          <p className="font-inter text-sm text-[#5B403C]">
            {address?.city}, {address?.state}
          </p>
          {address?.is_default && (
            <span className="mt-1 inline-block text-xs font-medium text-[#B61913]">
              Default
            </span>
          )}
        </div>
        <button
          onClick={() => setIsAddingNew(true)}
          className="rounded-full p-2 hover:bg-black/5"
        >
          <Edit2 className="size-4 text-[#5B403C]" />
        </button>
      </div>

      {/* Map Placeholder */}
      {showMap && (
        <div className="relative overflow-hidden rounded-xl border border-[#E4BEB8]">
          <div className="aspect-[4/3] w-full bg-[#E5E2E1]">
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <MapPin className="mx-auto size-8 text-[#5B403C]/40" />
                <p className="mt-2 text-sm text-[#5B403C]">Map view</p>
                <p className="text-xs text-[#5B403C]/60">
                  {address?.line1}, {address?.city}
                </p>
                {coords && (
                  <p className="mt-1 text-xs text-[#5B403C]/40">
                    📍 {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        </div>
      )}

      {/* Change Address (if multiple) */}
      {addresses.length > 1 && (
        <div className="space-y-2">
          <p className="font-inter text-xs font-medium text-[#5B403C]">
            Saved addresses
          </p>
          {addresses.map((addr) => (
            <button
              key={addr.id}
              onClick={() => onAddressChange(addr)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                addr.id === address?.id
                  ? "border-[#B61913] bg-[rgba(182,25,19,0.05)]"
                  : "border-[#E5E2E1] hover:border-[#B61913]"
              }`}
            >
              <p className="font-inter text-sm font-medium text-[#1C1B1B]">
                {addr.label || "Address"}
                {addr.is_default && (
                  <span className="ml-2 text-xs text-[#B61913]">Default</span>
                )}
              </p>
              <p className="font-inter text-xs text-[#5B403C]">
                {addr.line1}, {addr.city}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Add New Address Button */}
      <button
        onClick={() => setIsAddingNew(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#E4BEB8] py-3 text-sm font-medium text-[#5B403C] hover:border-[#B61913] hover:text-[#B61913]"
      >
        <Plus className="size-4" />
        Add new address
      </button>

      {/* Location Button (if address selected) */}
      <button
        onClick={useMyLocation}
        disabled={locating}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E2E1] px-4 py-3 text-sm font-medium text-[#5B403C] hover:border-[#B61913] disabled:opacity-50"
      >
        <LocateFixed className="size-4" />
        {locating
          ? "Locating..."
          : coords
            ? "Update with current location"
            : "Use my current location"}
      </button>
      {locationError && <p className="text-xs text-danger">{locationError}</p>}
    </div>
  );
}
