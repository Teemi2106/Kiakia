"use client";

import { searchAccountsAction, type AccountMatch } from "@/app/actions/admin-fleets";
import { Input } from "@kiakia/ui";
import { useRef, useState } from "react";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

interface AccountPickerProps {
  readonly id?: string;
  /** Name of the hidden field that carries the chosen account's id. */
  readonly name: string;
}

/**
 * Search existing accounts by name or phone and pick one. Submits the chosen
 * account's id (never typed text), so a form can only ever name a real person.
 */
export function AccountPicker({ id, name }: AccountPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly AccountMatch[] | null>(null);
  const [chosen, setChosen] = useState<AccountMatch | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Only the latest search may write results; a slow earlier one must not overwrite it.
  const latest = useRef(0);

  function onType(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    const term = value.trim();
    if (term.length < MIN_CHARS) {
      latest.current += 1;
      setResults(null);
      setFailed(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const ticket = ++latest.current;
      try {
        const found = await searchAccountsAction(term);
        if (ticket !== latest.current) return;
        setResults(found);
        setFailed(false);
      } catch {
        if (ticket !== latest.current) return;
        setResults(null);
        setFailed(true);
      }
    }, DEBOUNCE_MS);
  }

  function pick(account: AccountMatch) {
    setChosen(account);
    setQuery("");
    setResults(null);
  }

  if (chosen) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2">
        <input type="hidden" name={name} value={chosen.id} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{chosen.fullName ?? "Unnamed"}</p>
          <p className="text-xs text-ink-muted">{chosen.phone ?? "No phone"}</p>
        </div>
        <button type="button" onClick={() => setChosen(null)} className="shrink-0 text-sm text-brand-600 hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(event) => onType(event.target.value)}
        autoComplete="off"
        placeholder="Search by name or phone number"
        className="w-full"
      />
      {failed && <p className="mt-1 text-xs text-danger">Search failed. Try again.</p>}
      {results && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-control border border-border bg-surface py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No matching account. They need to sign up first.</li>}
          {results.map((account) => (
            <li key={account.id}>
              <button type="button" onClick={() => pick(account)} className="flex w-full flex-col px-3 py-2 text-left hover:bg-brand-50">
                <span className="text-sm font-medium text-ink">{account.fullName ?? "Unnamed"}</span>
                <span className="text-xs text-ink-muted">{account.phone ?? "No phone"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
