// app/(customer)/loading.tsx
//
// The fallback for every customer route without a loading.tsx of its own
// (home has one). Without it a navigation shows nothing new until the
// destination's server reads finish; with it the page frame appears at once.
// Routes that render from the customer store (/cart) never hit it.

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-kk-line/45 ${className ?? ""}`} />;
}

export default function CustomerLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <Shimmer className="h-8 w-56 rounded-xl sm:h-10" />
      <Shimmer className="mt-3 h-4 w-full max-w-md" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-4 rounded-3xl border border-kk-line/60 bg-white p-4">
            <Shimmer className="size-16 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2.5 py-1">
              <Shimmer className="h-5 w-1/3 rounded-lg" />
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-4 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
