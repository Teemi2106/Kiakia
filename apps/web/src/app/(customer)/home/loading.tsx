// app/(customer)/home/loading.tsx
//
// Mirrors HomeShell in page.tsx block for block — greeting panel, browse
// toolbar, then a featured rail over two vendor grids. The nav offset is not
// repeated here: (customer)/layout.tsx already insets <main> by the fixed
// header, and this renders inside it.

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-kk-line/45 ${className ?? ""}`} />;
}

export default function CustomerHomeLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-6 sm:pb-16 sm:pt-8">
      {/* Greeting panel */}
      <div className="rounded-3xl border border-kk-line/60 bg-gradient-to-br from-kk-red-soft/50 via-kk-cream to-kk-orange/10 px-5 py-7 sm:px-8 sm:py-9">
        <Shimmer className="h-3 w-32" />
        <Shimmer className="mt-4 h-8 w-64 rounded-xl sm:h-10" />
        <Shimmer className="mt-3 h-4 w-full max-w-md" />
        <Shimmer className="mt-2 h-4 w-2/3 max-w-sm" />
      </div>

      {/* Browse toolbar */}
      <div className="mt-9 space-y-4">
        <Shimmer className="h-3 w-24" />
        <div className="flex gap-2.5 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <Shimmer key={i} className="h-11 w-28 shrink-0" />
          ))}
        </div>
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <Shimmer key={i} className="h-9 w-28 shrink-0" />
          ))}
        </div>
      </div>

      {/* Featured rail */}
      <div className="mt-10">
        <Shimmer className="h-6 w-44 rounded-lg" />
        <div className="mt-5 flex gap-4 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Shimmer
              key={i}
              className="aspect-4/5 w-[188px] shrink-0 rounded-3xl sm:w-[232px]"
            />
          ))}
        </div>
      </div>

      {/* Vendor grids, matching the default Top rated + All vendors view */}
      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="mt-12">
          <Shimmer className="h-6 w-40 rounded-lg" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-3xl border border-kk-line/60 bg-white"
              >
                <Shimmer className="aspect-16/10 w-full rounded-none" />
                <div className="space-y-2.5 p-4">
                  <Shimmer className="h-5 w-2/3 rounded-lg" />
                  <Shimmer className="h-4 w-1/3" />
                  <Shimmer className="h-6 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
