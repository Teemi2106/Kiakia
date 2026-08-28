// app/(customer)/home/_components/SectionHeading.tsx

/**
 * One heading treatment for every band on the home page, so "Featured",
 * "Top rated" and "All vendors" read as the same kind of thing instead of
 * three bare <h2>s at slightly different weights.
 *
 * `count` and `hint` are deliberately separate: the count is a fact about
 * the list underneath, the hint explains how that list was ordered. The
 * home page's sections are plain sorts, not editorial picks, and saying so
 * here is cheaper than a card badge implying otherwise.
 */
export function SectionHeading({
  title,
  hint,
  count,
  action,
}: {
  title: string;
  hint?: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-kk-red" />
          <h2 className="font-sora text-xl font-bold tracking-tight text-kk-ink sm:text-2xl">
            {title}
          </h2>
          {count != null && (
            <span className="rounded-full bg-kk-red/10 px-2 py-0.5 font-inter text-xs font-bold text-kk-red">
              {count}
            </span>
          )}
        </div>
        {hint && (
          <p className="mt-1.5 pl-4 font-inter text-[13px] text-kk-cocoa/85">{hint}</p>
        )}
      </div>
      {action}
    </div>
  );
}
