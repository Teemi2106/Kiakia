"use client";

import { updateVendorSettingsAction, type FormState } from "@/app/actions/vendor";
import { Button, Input, Textarea } from "@kiakia/ui";
import { useActionState, useState } from "react";
import type { ChangeEvent } from "react";

interface VendorSettings {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly addressLine: string | null;
  readonly landmark: string | null;
  readonly state: string | null;
  readonly avgPrepMins: number;
  readonly minOrderKobo: number;
  readonly deliveryRadiusM: number;
  readonly isAcceptingOrders: boolean;
  readonly bannerUrl: string | null;
}

const initialState: FormState = {};

export function SettingsForm({ vendor }: { vendor: VendorSettings }) {
  const [state, formAction, pending] = useActionState(updateVendorSettingsAction, initialState);
  const [bannerPreview, setBannerPreview] = useState<string | null>(vendor.bannerUrl);

  function handleBannerChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBannerPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="vendorId" value={vendor.id} />
      <input type="hidden" name="currentBannerUrl" value={vendor.bannerUrl ?? ""} />

      <div>
        <label htmlFor="banner" className="text-sm font-medium text-[#1C1B1B]">
          Store photo
        </label>
        <p className="text-xs text-[#5B403C]">Shown to customers on your storefront and the home page listing.</p>
        {bannerPreview && (
          // eslint-disable-next-line @next/next/no-img-element -- transient local/uploaded preview, not an optimizable remote asset
          <img src={bannerPreview} alt="" className="mt-2 h-40 w-full rounded-xl border border-[#E4BEB8] object-cover" />
        )}
        <input
          id="banner"
          name="banner"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          onChange={handleBannerChange}
          className="mt-2 block w-full text-sm text-[#1C1B1B] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#FFDAD5] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#B61913] hover:file:bg-[#FFC7C0]"
        />
      </div>

      <div className="space-y-4 border-t border-[#E4BEB8] pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Store details</p>

        <div>
          <label htmlFor="name" className="text-sm font-medium text-[#1C1B1B]">
            Store Name
          </label>
          <Input id="name" name="name" required defaultValue={vendor.name} className="mt-1 w-full" />
        </div>

        <div>
          <label htmlFor="description" className="text-sm font-medium text-[#1C1B1B]">
            About your store
          </label>
          <Textarea id="description" name="description" rows={3} defaultValue={vendor.description ?? ""} className="mt-1 w-full" />
        </div>

        <div>
          <label htmlFor="addressLine" className="text-sm font-medium text-[#1C1B1B]">
            Store Address
          </label>
          <Input id="addressLine" name="addressLine" defaultValue={vendor.addressLine ?? ""} className="mt-1 w-full" />
        </div>

        <div>
          <label htmlFor="landmark" className="text-sm font-medium text-[#1C1B1B]">
            Landmark
          </label>
          <Input id="landmark" name="landmark" defaultValue={vendor.landmark ?? ""} className="mt-1 w-full" />
        </div>

        <div>
          <label htmlFor="state" className="text-sm font-medium text-[#1C1B1B]">
            State
          </label>
          <p className="text-xs text-[#5B403C]">
            Customers outside this state will never see your store on the home page listing.
          </p>
          <Input id="state" name="state" required defaultValue={vendor.state ?? ""} className="mt-1 w-full" />
        </div>
      </div>

      <div className="space-y-4 border-t border-[#E4BEB8] pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5B403C]">Ordering settings</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="avgPrepMins" className="text-xs font-medium text-[#5B403C]">
              Prep time (min)
            </label>
            <Input id="avgPrepMins" name="avgPrepMins" type="number" min={1} defaultValue={vendor.avgPrepMins} className="mt-1 w-full" />
          </div>
          <div>
            <label htmlFor="minOrderNaira" className="text-xs font-medium text-[#5B403C]">
              Min. order (₦)
            </label>
            <Input
              id="minOrderNaira"
              name="minOrderNaira"
              type="number"
              min={0}
              defaultValue={vendor.minOrderKobo / 100}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <label htmlFor="deliveryRadiusM" className="text-xs font-medium text-[#5B403C]">
              Delivery radius (m)
            </label>
            <Input
              id="deliveryRadiusM"
              name="deliveryRadiusM"
              type="number"
              min={500}
              defaultValue={vendor.deliveryRadiusM}
              className="mt-1 w-full"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#E4BEB8] bg-[#F6F3F2] p-4">
          <span>
            <span className="block text-sm font-medium text-[#1C1B1B]">Accepting orders</span>
            <span className="block text-xs text-[#5B403C]">Customers can place new orders while this is on.</span>
          </span>
          <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
            <input
              type="checkbox"
              name="isAcceptingOrders"
              defaultChecked={vendor.isAcceptingOrders}
              className="peer sr-only"
            />
            <span className="absolute inset-0 rounded-full bg-[#F0EDED] transition-colors peer-checked:bg-[#176A22]" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </label>
      </div>

      {state.error && <p className="text-sm text-[#BA1A1A]">{state.error}</p>}
      {state.success && <p className="text-sm text-[#176A22]">Saved.</p>}

      <Button type="submit" loading={pending} className="w-full">
        Save Changes
      </Button>
    </form>
  );
}
