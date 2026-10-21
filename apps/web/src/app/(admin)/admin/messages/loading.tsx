export default function MessagesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" role="status" aria-label="Loading messages">
      <div className="h-7 w-40 animate-pulse rounded-control bg-border" />
      <div className="h-96 animate-pulse rounded-card bg-border/60" />
      <div className="h-7 w-48 animate-pulse rounded-control bg-border" />
      <div className="h-48 animate-pulse rounded-card bg-border/60" />
    </div>
  );
}
