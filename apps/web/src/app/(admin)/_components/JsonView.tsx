import type { Json } from "@kiakia/db";
import { humanize } from "./format";

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: Json | undefined): string | null {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return null;
  return String(value);
}

/** Key/value rendering of an audit-details or event-meta object; nested values fall back to formatted JSON. */
export function JsonView({ value }: { value: Json }) {
  if (!isRecord(value)) {
    const text = scalar(value);
    if (text === "—" || (Array.isArray(value) && value.length === 0)) return null;
    return text === null ? (
      <pre className="whitespace-pre-wrap font-mono text-xs text-ink">{JSON.stringify(value, null, 2)}</pre>
    ) : (
      <span className="text-sm text-ink">{text}</span>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return null;

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {entries.map(([key, entry]) => {
        const text = scalar(entry);
        return (
          <div key={key} className="contents">
            <dt className="text-ink-muted">{humanize(key)}</dt>
            <dd className="min-w-0 break-words text-ink">
              {text ?? <pre className="whitespace-pre-wrap font-mono">{JSON.stringify(entry, null, 2)}</pre>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
