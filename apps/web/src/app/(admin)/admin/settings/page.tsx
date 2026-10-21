import { getDispatchSettings, listRecentDispatchChanges } from "@/lib/admin/dispatch";
import { getPlatformFees, listRecentFeeChanges } from "@/lib/admin/platform-fees";
import { listServiceAreas } from "@/lib/admin/settings";
import { canManageFinance, requireAdminContext } from "@/lib/auth/dal";
import { Badge, EmptyState } from "@kiakia/ui";
import type { Metadata } from "next";
import { formatDateTime, money } from "../../_components/format";
import { PageHeader } from "../../_components/PageHeader";
import { Fields, Section } from "../../_components/Section";
import { PlatformFeesSection } from "./_components/PlatformFeesSection";
import { RiderMatchingSection } from "./_components/RiderMatchingSection";
import { ServiceAreaForm } from "./_components/ServiceAreaForm";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdminContext();
  const financeAccess = await canManageFinance();

  const [areas, fees, changes, dispatch, dispatchChanges] = await Promise.all([
    listServiceAreas(),
    getPlatformFees(),
    listRecentFeeChanges(),
    getDispatchSettings(),
    listRecentDispatchChanges(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="The fees KiaKia charges, how orders are matched to riders, and where it delivers. You can change fees and switch a delivery area on or off. Area boundaries cannot be changed here."
      />

      <PlatformFeesSection fees={fees} changes={changes} canEdit={financeAccess} />

      <RiderMatchingSection settings={dispatch} changes={dispatchChanges} canEdit />

      <div id="delivery-areas" className="flex scroll-mt-4 flex-col gap-6">
      {areas.length === 0 ? (
        <EmptyState title="No delivery areas set up" description="Delivery areas are added by the technical team." />
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
                    { label: "Customer pays: base delivery fee", value: money(area.baseDeliveryFeeKobo) },
                    { label: "Customer pays: fee per km", value: money(area.perKmFeeKobo) },
                    { label: "Rider earns: base fee", value: money(area.riderBaseFeeKobo) },
                    { label: "Rider earns: fee per km", value: money(area.riderPerKmFeeKobo) },
                    { label: "Status", value: area.isActive ? "Active" : "Inactive" },
                  ]}
                />
                <p className="mt-3 text-sm text-ink-muted">Only finance admins and superadmins can change fees or switch an area on or off. Ask one of them.</p>
              </>
            )}
          </Section>
        ))
      )}
      </div>
    </div>
  );
}
