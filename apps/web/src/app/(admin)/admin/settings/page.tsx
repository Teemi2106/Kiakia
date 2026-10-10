import { listServiceAreas } from "@/lib/admin/settings";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { formatDateTime, money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Fields, Section } from "../../_components/Section";
import { ServiceAreaForm } from "./_components/ServiceAreaForm";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const areas = await listServiceAreas();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Delivery fees and activation for each service area. Area boundaries are not editable here."
      />

      {areas.length === 0 ? (
        <EmptyState title="No service areas" />
      ) : (
        areas.map((area) => (
          <Section
            key={area.id}
            title={area.name}
            aside={
              <span className="flex items-center gap-2">
                {area.launchedAt && <span className="text-xs text-ink-muted">Launched {formatDateTime(area.launchedAt)}</span>}
                <Badge tone={area.isActive ? "positive" : "neutral"}>{area.isActive ? "Active" : "Inactive"}</Badge>
              </span>
            }
          >
            {financeAccess ? (
              <ServiceAreaForm area={area} />
            ) : (
              <>
                <Fields
                  items={[
                    { label: "Base delivery fee", value: money(area.baseDeliveryFeeKobo) },
                    { label: "Delivery fee per km", value: money(area.perKmFeeKobo) },
                    { label: "Rider base fee", value: money(area.riderBaseFeeKobo) },
                    { label: "Rider fee per km", value: money(area.riderPerKmFeeKobo) },
                    { label: "Status", value: area.isActive ? "Active" : "Inactive" },
                  ]}
                />
                <p className="mt-3 text-sm text-ink-muted">Changing fees or activation needs finance access.</p>
              </>
            )}
          </Section>
        ))
      )}
    </div>
  );
}
