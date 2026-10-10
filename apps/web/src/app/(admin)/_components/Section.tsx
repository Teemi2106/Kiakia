import { Card, CardHeader, CardTitle } from "@kiakia/ui";
import type { ReactNode } from "react";

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      {children}
    </Card>
  );
}

/** Label/value rows for a record's fields. */
export function Fields({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
