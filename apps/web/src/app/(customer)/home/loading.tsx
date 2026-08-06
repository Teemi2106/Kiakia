export default function CustomerHomeLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-sunken" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card border border-border bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
