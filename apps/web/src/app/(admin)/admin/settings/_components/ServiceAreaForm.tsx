import { updateServiceAreaAction } from "@/app/actions/admin-settings";
import type { ServiceAreaView } from "@/lib/admin/settings";
import { Input, Select } from "@kiakia/ui";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";
import { nairaInputValue } from "../../../_components/format";

export function ServiceAreaForm({ area }: { area: ServiceAreaView }) {
  const fees = [
    { name: "baseDeliveryFeeNaira", label: "Base delivery fee (naira)", kobo: area.baseDeliveryFeeKobo },
    { name: "perKmFeeNaira", label: "Delivery fee per km (naira)", kobo: area.perKmFeeKobo },
    { name: "riderBaseFeeNaira", label: "Rider base fee (naira)", kobo: area.riderBaseFeeKobo },
    { name: "riderPerKmFeeNaira", label: "Rider fee per km (naira)", kobo: area.riderPerKmFeeKobo },
  ];

  return (
    <AdminActionForm
      action={updateServiceAreaAction}
      submitLabel="Save changes"
      reason={{ required: true }}
      confirmLabel="I confirm these fees apply to new orders in this area."
    >
      <input type="hidden" name="serviceAreaId" value={area.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fees.map((fee) => (
          <Field key={fee.name} label={fee.label} htmlFor={`${fee.name}-${area.id}`}>
            <Input
              id={`${fee.name}-${area.id}`}
              name={fee.name}
              inputMode="decimal"
              required
              defaultValue={nairaInputValue(fee.kobo)}
            />
          </Field>
        ))}
        <Field label="Status" htmlFor={`isActive-${area.id}`}>
          <Select id={`isActive-${area.id}`} name="isActive" defaultValue={String(area.isActive)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
      </div>
    </AdminActionForm>
  );
}
