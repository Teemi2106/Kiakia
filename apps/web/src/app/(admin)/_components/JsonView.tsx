import type { Json } from "@kiakia/db";
import { formatPercent, humanize, money } from "./format";

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: Json | undefined): string | null {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return null;
  return String(value);
}

/** "amount_kobo" is shown as "Amount: N5,000.00" and "from_bps" as "From: 15%": raw units never reach the screen. */
function present(key: string, value: Json | undefined): { label: string; text: string | null } {
  const unit = key.endsWith("_kobo") ? "_kobo" : key.endsWith("_bps") ? "_bps" : null;
  if (unit && typeof value === "number") {
    return { label: humanize(key.slice(0, -unit.length)), text: unit === "_kobo" ? money(value) : formatPercent(value) };
  }
  return { label: humanize(key), text: scalar(value) };
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
        const { label, text } = present(key, entry);
        return (
          <div key={key} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0 break-words text-ink">
              {text ?? <pre className="whitespace-pre-wrap font-mono">{JSON.stringify(entry, null, 2)}</pre>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
