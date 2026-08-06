"use client";

import { createMenuItemAction, updateMenuItemAction, type FormState } from "@/app/actions/menu";
import { Button, Input, Select, Textarea } from "@kiakia/ui";
import { useActionState, useState } from "react";
import { OptionGroupsBuilder, type OptionGroupState } from "./OptionGroupsBuilder";

interface Category {
  readonly id: string;
  readonly name: string;
}

interface ExistingItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly priceKobo: number;
  readonly categoryId: string | null;
  readonly isAvailable: boolean;
  readonly optionGroups: readonly OptionGroupState[];
}

const initialState: FormState = {};

export function MenuItemForm({
  vendorId,
  categories,
  existingItem,
}: {
  vendorId: string;
  categories: readonly Category[];
  existingItem?: ExistingItem;
}) {
  const action = existingItem ? updateMenuItemAction : createMenuItemAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [groups, setGroups] = useState<OptionGroupState[]>([...(existingItem?.optionGroups ?? [])]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="vendorId" value={vendorId} />
      {existingItem && <input type="hidden" name="itemId" value={existingItem.id} />}
      <input type="hidden" name="optionGroups" value={JSON.stringify(groups)} />

      <div>
        <label htmlFor="name" className="text-sm font-medium text-ink">
          Item Name
        </label>
        <Input id="name" name="name" required defaultValue={existingItem?.name} className="mt-1 w-full" />
      </div>

      <div>
        <label htmlFor="description" className="text-sm font-medium text-ink">
          Description
        </label>
        <Textarea id="description" name="description" rows={2} defaultValue={existingItem?.description ?? ""} className="mt-1 w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="priceNaira" className="text-sm font-medium text-ink">
            Price (₦)
          </label>
          <Input
            id="priceNaira"
            name="priceNaira"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={existingItem ? existingItem.priceKobo / 100 : undefined}
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="categoryId" className="text-sm font-medium text-ink">
            Category
          </label>
          <Select id="categoryId" name="categoryId" defaultValue={existingItem?.categoryId ?? ""} className="mt-1 w-full">
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <label htmlFor="imageUrl" className="text-sm font-medium text-ink">
          Image URL (optional)
        </label>
        <Input id="imageUrl" name="imageUrl" type="url" defaultValue={existingItem?.imageUrl ?? ""} className="mt-1 w-full" />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="isAvailable" defaultChecked={existingItem?.isAvailable ?? true} />
        Available for order
      </label>

      <div>
        <h2 className="text-sm font-semibold text-ink">Options (e.g. sizes, extras)</h2>
        <div className="mt-2">
          <OptionGroupsBuilder groups={groups} onChange={setGroups} />
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" loading={pending} className="w-full">
        {existingItem ? "Save changes" : "Add item"}
      </Button>
    </form>
  );
}
