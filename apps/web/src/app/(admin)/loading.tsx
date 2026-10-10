export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-7 w-48 animate-pulse rounded-control bg-border" />
      <div className="h-24 animate-pulse rounded-card bg-border/60" />
      <div className="h-64 animate-pulse rounded-card bg-border/60" />
    </div>
  );
}
