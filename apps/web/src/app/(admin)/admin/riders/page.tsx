import { countRidersByState, listRiders } from "@/lib/admin/riders";
import { requireAdminContext } from "@/lib/auth/dal";
import { Badge, Button, EmptyState, Input, Select, buttonVariants } from "@kiakia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "../../_components/Field";
import { formatDateTime, humanize } from "../../_components/format";
import { LinkTabs } from "../../_components/LinkTabs";
import { PageHeader } from "../../_components/PageHeader";
import { Pagination } from "../../_components/Pagination";
import { firstParam, pageParam, type SearchParams } from "../../_components/search-params";
import { StatusPill } from "../../_components/StatusPill";
import { Table, Td, Th, Tr } from "../../_components/Table";

export const metadata: Metadata = { title: "Riders" };

const STATES = ["pending", "active", "suspended", "rejected"] as const;
type State = (typeof STATES)[number];

const STATE_LABELS: Record<State, string> = {
  pending: "Pending approval",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
};

const EMPTY: Record<State | "all", { title: string; description: string }> = {
  all: { title: "No riders found", description: "Try a different name or phone number, or clear the filters." },
  pending: { title: "No riders waiting for approval", description: "Riders who sign up and upload their documents will show up here." },
  active: { title: "No active riders", description: "Approved riders who can take deliveries will show up here." },
  suspended: { title: "No suspended riders", description: "Riders you suspend are listed here, and can be reinstated." },
  rejected: { title: "No rejected riders", description: "Riders whose application you turned down are listed here." },
};

export default async function AdminRidersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminContext();

  const raw = await searchParams;
  const q = firstParam(raw.q);
  const state = STATES.find((value) => value === firstParam(raw.state));
  const availability = (["online", "offline"] as const).find((value) => value === firstParam(raw.availability));
  const [riders, counts] = await Promise.all([
    listRiders({ q, state, availability, page: pageParam(raw.page) }),
    countRidersByState(),
  ]);

  const tabHref = (value?: State) => {
    const query = new URLSearchParams();
    if (value) query.set("state", value);
    if (q) query.set("q", q);
    if (availability) query.set("availability", availability);
    const string = query.toString();
    return string ? `/admin/riders?${string}` : "/admin/riders";
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        title="Riders"
        description="The people who deliver orders. Check a new rider's documents, then approve them so they can take deliveries."
      />

      <LinkTabs
        label="Rider status"
        value={state ?? "all"}
        items={[
          ...STATES.map((value) => ({ value, label: STATE_LABELS[value], href: tabHref(value), count: counts[value] })),
          { value: "all", label: "All", href: tabHref(), count: counts.pending + counts.active + counts.suspended + counts.rejected },
        ]}
      />

      <form method="get" action="/admin/riders" className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-3">
        {state && <input type="hidden" name="state" value={state} />}
        <Field label="Search by name, phone or plate number" htmlFor="q">
          <Input id="q" name="q" defaultValue={q} />
        </Field>
        <Field label="Availability" htmlFor="availability">
          <Select id="availability" name="availability" defaultValue={availability ?? ""}>
            <option value="">All</option>
            <option value="online">Online now</option>
            <option value="offline">Offline</option>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          {(q || availability) && (
            <Link href={tabHref()} className="inline-flex h-10 items-center px-2 text-sm text-ink-muted hover:text-ink">
              Clear
            </Link>
          )}
        </div>
      </form>

      {riders.rows.length === 0 ? (
        <EmptyState {...(q || availability ? EMPTY.all : EMPTY[state ?? "all"])} />
      ) : (
        <Table
          head={
            <>
              <Th>Rider</Th>
              <Th>Status</Th>
              <Th>Documents to check</Th>
              <Th>Vehicle</Th>
              <Th>Availability</Th>
              <Th>Joined</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </>
          }
        >
          {riders.rows.map((rider) => (
            <Tr key={rider.userId}>
              <Td>
                <Link href={`/admin/riders/${rider.userId}`} className="font-medium text-brand-600 hover:underline">
                  {rider.fullName ?? "Unnamed rider"}
                </Link>
                <p className="text-xs text-ink-muted">{rider.phone ?? "No phone"}</p>
              </Td>
              <Td>
                <StatusPill status={rider.state} label={rider.state === "pending" ? "Pending approval" : undefined} />
              </Td>
              <Td>{rider.documentsPending > 0 ? <Badge tone="warning">{rider.documentsPending}</Badge> : "—"}</Td>
              <Td>
                {rider.vehicleType ? humanize(rider.vehicleType) : "—"}
                {rider.plateNumber && <p className="text-xs text-ink-muted">{rider.plateNumber}</p>}
              </Td>
              <Td>
                <Badge tone={rider.isOnline ? "positive" : "neutral"}>{rider.isOnline ? "Online" : "Offline"}</Badge>
              </Td>
              <Td>{formatDateTime(rider.createdAt)}</Td>
              <Td>
                <Link
                  href={`/admin/riders/${rider.userId}`}
                  className={buttonVariants({ variant: rider.state === "pending" ? "primary" : "secondary", size: "sm" })}
                >
                  {rider.state === "pending" ? "Review" : "Open"}
                </Link>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      <Pagination basePath="/admin/riders" params={{ q, state, availability }} page={riders.page} pageSize={riders.pageSize} total={riders.total} />
    </div>
  );
}
