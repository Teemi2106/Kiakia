export default function DispatchLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" role="status" aria-label="Loading orders waiting for a rider">
      <div className="h-7 w-64 animate-pulse rounded-control bg-border" />
      <div className="h-40 animate-pulse rounded-card bg-border/60" />
      <div className="h-40 animate-pulse rounded-card bg-border/60" />
    </div>
  );
}
