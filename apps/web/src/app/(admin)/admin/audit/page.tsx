import { AUDIT_TARGET_TYPES, listAuditLog } from "@/lib/admin/audit";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Input, Select } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, humanize } from "../../_components/format";
import { JsonView } from "../../_components/JsonView";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";

export const metadata: Metadata = { title: "Audit log" };

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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader title="Audit log" description="Every admin action, newest first, with the reason that was given." />

      <form method="get" action="/admin/audit" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Action" htmlFor="action">
          <Input id="action" name="action" defaultValue={filters.action} placeholder="vendor.set_commission" />
        </Field>
        <Field label="Target type" htmlFor="targetType">
          <Select id="targetType" name="targetType" defaultValue={filters.targetType ?? ""}>
            <option value="">All</option>
            {AUDIT_TARGET_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target ID" htmlFor="targetId">
          <Input id="targetId" name="targetId" defaultValue={filters.targetId} />
        </Field>
        <Field label="Actor ID" htmlFor="actorId">
          <Input id="actorId" name="actorId" defaultValue={filters.actorId} />
        </Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">Filter</Button>
          <Link href="/admin/audit" className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
            Reset
          </Link>
        </div>
      </form>

      {log.rows.length === 0 ? (
        <EmptyState title="No audit entries match" />
      ) : (
        <ol className="flex flex-col gap-3">
          {log.rows.map((entry) => {
            const targetPath = TARGET_PATHS[entry.targetType];
            return (
              <li key={entry.id} className="rounded-card border border-border bg-surface-raised p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{entry.action}</Badge>
                    <span className="text-sm text-ink">by {entry.actorName ?? entry.actorId}</span>
                  </div>
                  <span className="text-xs text-ink-muted">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm text-ink-muted">
                  {humanize(entry.targetType)}{" "}
                  {targetPath ? (
                    <Link href={`/admin/${targetPath}/${entry.targetId}`} className="font-mono text-xs text-brand-600 hover:underline">
                      {entry.targetId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{entry.targetId}</span>
                  )}
                </p>
                {entry.reason && <p className="mt-2 text-sm text-ink">Reason: {entry.reason}</p>}
                <div className="mt-2">
                  <JsonView value={entry.details} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Pagination
        basePath="/admin/audit"
        params={filters}
        page={log.page}
        pageSize={log.pageSize}
        total={log.total}
      />
    </div>
  );
}
