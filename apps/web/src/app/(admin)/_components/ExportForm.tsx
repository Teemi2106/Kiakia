import { Button, Input } from "@kiakia/ui";
import { Field } from "./Field";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Pre-fill for the export date inputs: the page's own from/to filters when both
 * are valid dates, else the last 30 days ending today (UTC).
 */
export function defaultExportRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to && DAY.test(from) && DAY.test(to)) return { from, to };
  const now = Date.now();
  return {
    from: new Date(now - 29 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

/**
 * A plain HTML form POST to a CSV Route Handler (not a Server Action: the
 * response is a file download). `hidden` carries filters from the page through
 * as hidden inputs; blank values are skipped.
 */
export function ExportForm({
  action,
  idPrefix,
  title,
  description,
  defaultFrom,
  defaultTo,
  hidden = {},
}: {
  action: string;
  /** Short, page-unique prefix for the input ids. */
  idPrefix: string;
  title: string;
  description?: string;
  defaultFrom: string;
  defaultTo: string;
  hidden?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <form
      method="post"
      action={action}
      className="grid gap-3 rounded-card border border-border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="flex flex-col justify-center sm:col-span-2 lg:col-span-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="text-xs text-ink-muted">{description}</p>}
      </div>
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <Field label="From" htmlFor={`${idPrefix}-from`}>
        <Input id={`${idPrefix}-from`} name="from" type="date" required defaultValue={defaultFrom} />
      </Field>
      <Field label="To (inclusive)" htmlFor={`${idPrefix}-to`}>
        <Input id={`${idPrefix}-to`} name="to" type="date" required defaultValue={defaultTo} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="secondary">
          Export CSV
        </Button>
      </div>
    </form>
  );
}
