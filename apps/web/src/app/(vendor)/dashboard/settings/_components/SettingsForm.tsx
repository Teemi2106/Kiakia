"use client";

import { updateVendorSettingsAction, type FormState } from "@/app/actions/vendor";
import { Button, Input, Textarea } from "@kiakia/ui";
import { useActionState } from "react";

interface VendorSettings {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly addressLine: string | null;
  readonly landmark: string | null;
  readonly avgPrepMins: number;
  readonly minOrderKobo: number;
  readonly deliveryRadiusM: number;
  readonly isAcceptingOrders: boolean;
}

const initialState: FormState = {};

export function SettingsForm({ vendor }: { vendor: VendorSettings }) {
  const [state, formAction, pending] = useActionState(updateVendorSettingsAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="vendorId" value={vendor.id} />

      <div>
        <label htmlFor="name" className="text-sm font-medium text-ink">
          Store Name
        </label>
        <Input id="name" name="name" required defaultValue={vendor.name} className="mt-1 w-full" />
      </div>

      <div>
        <label htmlFor="description" className="text-sm font-medium text-ink">
          About your store
        </label>
        <Textarea id="description" name="description" rows={3} defaultValue={vendor.description ?? ""} className="mt-1 w-full" />
      </div>

      <div>
        <label htmlFor="addressLine" className="text-sm font-medium text-ink">
          Store Address
        </label>
        <Input id="addressLine" name="addressLine" defaultValue={vendor.addressLine ?? ""} className="mt-1 w-full" />
      </div>

      <div>
        <label htmlFor="landmark" className="text-sm font-medium text-ink">
          Landmark
        </label>
        <Input id="landmark" name="landmark" defaultValue={vendor.landmark ?? ""} className="mt-1 w-full" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="avgPrepMins" className="text-xs font-medium text-ink-muted">
            Prep time (min)
          </label>
          <Input id="avgPrepMins" name="avgPrepMins" type="number" min={1} defaultValue={vendor.avgPrepMins} className="mt-1 w-full" />
        </div>
        <div>
          <label htmlFor="minOrderNaira" className="text-xs font-medium text-ink-muted">
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
          <label htmlFor="deliveryRadiusM" className="text-xs font-medium text-ink-muted">
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

      <label className="flex items-center justify-between rounded-control border border-border p-3 text-sm text-ink">
        Accepting orders
        <input type="checkbox" name="isAcceptingOrders" defaultChecked={vendor.isAcceptingOrders} />
      </label>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.success && <p className="text-sm text-positive">Saved.</p>}

      <Button type="submit" loading={pending} className="w-full">
        Save Changes
      </Button>
    </form>
  );
}
