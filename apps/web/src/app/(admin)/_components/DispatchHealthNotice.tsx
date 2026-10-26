import type { DispatchHealth } from "@/lib/admin/dispatch-health-info";

/**
 * The dispatch timer's health in plain words. Red banner when something is wrong,
 * one quiet green line when fine, a neutral line when the check itself failed.
 */
export function DispatchHealthNotice({ health }: { health: DispatchHealth }) {
  if (health.state === "unknown") {
    return (
      <p role="status" className="text-xs text-ink-muted">
        Could not check the dispatch timer.
      </p>
    );
  }
  if (health.state === "healthy") {
    return (
      <p role="status" className="text-xs text-ink-muted">
        <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-positive align-middle" />
        Dispatch timer running. {health.lastRanText}
      </p>
    );
  }
  return (
    <div role="alert" className="rounded-control border border-danger bg-danger-surface px-4 py-3 text-sm">
      <p className="font-semibold text-danger">Rider search may not be working</p>
      <p className="mt-0.5 text-ink">The dispatch timer is what starts and moves along every rider search. {health.lastRanText}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-ink">
        {health.problems.map((problem) => (
          <li key={problem.message}>
            {problem.message}
            {problem.nextStep && <span className="block text-ink-muted">What to do: {problem.nextStep}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
