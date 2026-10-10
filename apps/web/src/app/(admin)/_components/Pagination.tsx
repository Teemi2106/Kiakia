import { buttonVariants, cn } from "@kiakia/ui";
import Link from "next/link";

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  /** Active filters, carried across page links. */
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    if (target > 1) query.set("page", String(target));
    const string = query.toString();
    return string ? `${basePath}?${string}` : basePath;
  };

  const linkClass = buttonVariants({ variant: "secondary", size: "sm" });
  const disabledClass = cn(linkClass, "pointer-events-none opacity-50");

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm text-ink-muted">
      <span>
        Page {page} of {lastPage} · {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Previous
          </span>
        )}
        {page < lastPage ? (
          <Link href={href(page + 1)} className={linkClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
