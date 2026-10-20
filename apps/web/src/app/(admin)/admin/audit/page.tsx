import { AUDIT_TARGET_TYPES, listAuditLog } from "@/lib/admin/audit";
import { requireAdminContext } from "@/lib/auth/dal";
import { Button, EmptyState, Input, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime } from "../../_components/format";
import { AUDIT_ACTIONS, auditActionLabel, auditTargetLabel } from "../../_components/labels";
import { JsonView } from "../../_components/JsonView";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";

export const metadata: Metadata = { title: "Activity log" };

const TARGET_PATHS: Record<string, string> = {
  user: "users",
  vendor: "vendors",
  rider: "riders",
  order: "orders",
};

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const filters = {
    action: firstParam(raw.action),
    targetType: firstParam(raw.targetType),
    targetId: firstParam(raw.targetId),
    actorId: firstParam(raw.actorId),
  };
  const log = await listAuditLog({ ...filters, page: pageParam(raw.page) });
  const knownAction = !filters.action || AUDIT_ACTIONS.includes(filters.action);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title="Activity log"
        description="A record of everything admins have done: who did what, to whom, and when. Entries cannot be edited or deleted."
      />

      <form method="get" action="/admin/audit" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2">
        <Field label="What was done" htmlFor="action">
          <Select id="action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">Anything</option>
            {!knownAction && <option value={filters.action}>{filters.action}</option>}
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Done to" htmlFor="targetType">
          <Select id="targetType" name="targetType" defaultValue={filters.targetType ?? ""}>
            <option value="">Anything</option>
            {AUDIT_TARGET_TYPES.map((type) => (
              <option key={type} value={type}>
                {auditTargetLabel(type)}
              </option>
            ))}
          </Select>
        </Field>
        <details className="sm:col-span-2" open={Boolean(filters.targetId || filters.actorId)}>
          <summary className="cursor-pointer text-sm text-brand-600">Filter by ID instead (for support or developers)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="ID of the thing it was done to" htmlFor="targetId">
              <Input id="targetId" name="targetId" defaultValue={filters.targetId} />
            </Field>
            <Field label="ID of the admin who did it" htmlFor="actorId">
              <Input id="actorId" name="actorId" defaultValue={filters.actorId} />
            </Field>
          </div>
        </details>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">Show</Button>
          <Link href="/admin/audit" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Clear
          </Link>
        </div>
      </form>

      {log.rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="No admin activity matches these filters." />
      ) : (
        <ol className="flex flex-col gap-3">
          {log.rows.map((entry) => {
            const targetPath = TARGET_PATHS[entry.targetType];
            const target = entry.targetName ?? `this ${auditTargetLabel(entry.targetType).toLowerCase()}`;
            return (
              <li key={entry.id} className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
                <p className="text-sm text-ink">
                  <span className="font-medium">{entry.actorName ?? "An admin"}</span>: {auditActionLabel(entry.action).toLowerCase()}
                  {entry.targetType !== "export" && (
                    <>
                      {" "}
                      (
                      {targetPath ? (
                        <Link href={`/admin/${targetPath}/${entry.targetId}`} className="text-brand-600 hover:underline">
                          {target}
                        </Link>
                      ) : (
                        target
                      )}
                      )
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{formatDateTime(entry.createdAt)}</p>
                {entry.reason && <p className="mt-2 text-sm text-ink">Reason given: {entry.reason}</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-muted">Details</summary>
                  <div className="mt-2">
                    <JsonView value={entry.details} />
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <Pagination basePath="/admin/audit" params={filters} page={log.page} pageSize={log.pageSize} total={log.total} />
    </div>
  );
}
