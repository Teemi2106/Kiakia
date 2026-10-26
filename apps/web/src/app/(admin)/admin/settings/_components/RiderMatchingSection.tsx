import type { DispatchChange, DispatchSettings } from "@/lib/admin/dispatch";
import {
  DISPATCH_SETTINGS,
  DISPATCH_SETTING_GROUPS,
  DISPATCH_SETTING_INFO,
  dispatchPreview,
  formatDispatchValue,
  formatSeconds,
  type DispatchSettingKey,
} from "@/lib/admin/dispatch-settings-info";
import Link from "next/link";
import { formatDateTime } from "../../../_components/format";
import { Fields, Section } from "../../../_components/Section";
import { DispatchSettingForm } from "./DispatchSettingForm";

function changeSummary(change: DispatchChange): string {
  if (!change.change) return "Changed a rider matching setting";
  const key = change.change.key as DispatchSettingKey;
  const info = DISPATCH_SETTING_INFO[key];
  if (!info) return "Changed a rider matching setting";
  return `${info.title}: ${formatDispatchValue(key, change.change.from)} to ${formatDispatchValue(key, change.change.to)}`;
}

export function RiderMatchingSection({ settings, changes, canEdit }: { settings: DispatchSettings; changes: readonly DispatchChange[]; canEdit: boolean }) {
  return (
    <div id="rider-matching" className="scroll-mt-4">
      <Section title="Rider matching">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 text-sm text-ink-muted">
            <p>
              Riders are asked one at a time, nearest first. Each rider has {formatSeconds(settings.values.offerTimeoutSeconds)} to answer. If they decline, the next rider is asked straight away. If nobody accepts after two full rounds, the order is flagged for your attention.
            </p>
            <p>
              If orders sit waiting with no rider, check{" "}
              <Link className="underline" href="/admin/dispatch">
                Waiting for a rider
              </Link>
              . A change here applies to orders from now on; offers already sent are unchanged.
            </p>
          </div>

          {DISPATCH_SETTING_GROUPS.map((group) => (
            <div key={group.id} id={`rider-matching-${group.id}`} className="flex flex-col gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">{group.title}</h3>
                <p className="text-sm text-ink-muted">{group.blurb}</p>
              </div>

              {DISPATCH_SETTINGS.filter((info) => info.group === group.id).map((info) => {
                const row = settings.rows.find((candidate) => candidate.key === info.key);
                if (!row && info.optional) return null;
                return (
                  <div key={info.key} className="flex flex-col gap-3 rounded-control border border-line p-4">
                    <h4 className="font-medium text-ink">{info.title}</h4>
                    <p className="text-sm text-ink-muted">{info.what}</p>
                    {row ? (
                      <>
                        <Fields
                          items={[
                            { label: "Right now", value: formatDispatchValue(info.key, row.value) },
                            { label: "What that means", value: dispatchPreview(info.key, row.value, settings.values) },
                            { label: "Last changed", value: `${formatDateTime(row.updatedAt)}${row.updatedByName ? ` by ${row.updatedByName}` : ""}` },
                            { label: "A change applies to", value: info.appliesTo },
                          ]}
                        />
                        {canEdit ? (
                          <DispatchSettingForm info={info} currentValue={row.value} current={settings.values} />
                        ) : (
                          <p className="text-sm text-ink-muted">Only admins can change rider matching. Ask an admin or a superadmin.</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-danger">This setting could not be loaded. Please contact the technical team.</p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className="flex flex-col gap-2 text-sm">
            <h3 className="font-medium text-ink">Recent rider matching changes</h3>
            {changes.length === 0 ? (
              <p className="text-ink-muted">Nothing has been changed yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {changes.map((change) => (
                  <li key={change.id} className="text-ink">
                    <span>{changeSummary(change)}</span>
                    <span className="text-ink-muted">
                      {" "}
                      · {formatDateTime(change.at)}
                      {change.actorName ? ` · ${change.actorName}` : ""}
                      {change.reason ? ` · "${change.reason}"` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="text-ink-muted underline" href="/admin/audit">
              See the full activity log
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
