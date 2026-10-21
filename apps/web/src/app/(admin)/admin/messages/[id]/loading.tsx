export default function MessageDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4" role="status" aria-label="Loading message">
      <div className="h-7 w-56 animate-pulse rounded-control bg-border" />
      <div className="h-24 animate-pulse rounded-card bg-border/60" />
      <div className="h-48 animate-pulse rounded-card bg-border/60" />
    </div>
  );
}
