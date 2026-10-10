import { cn } from "@kiakia/ui";
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** Horizontally scrollable so wide tables stay usable on a phone. */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-sm">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("px-4 py-2.5 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-top text-ink", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-sunken/60", className)} {...props} />;
}
