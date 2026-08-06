import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Standard empty/zero-data state. §14 asks that the customer app show
 * cached data with a "last updated" stamp rather than a spinner when
 * offline; this component is the counterpart for the genuinely-empty case
 * (no orders yet, no menu items yet) so every route group answers the
 * "nothing here" state the same way instead of ad hoc per screen.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-card border border-dashed border-border p-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
