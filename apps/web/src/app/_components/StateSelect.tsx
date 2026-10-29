"use client";

import { NIGERIAN_STATES, stateLabel } from "@kiakia/domain";
import { Input } from "@kiakia/ui";
import { ChevronDown } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

interface StateSelectProps {
  readonly id?: string;
  /** Submitted with the surrounding <form>; the typed search text never is. */
  readonly name?: string;
  readonly value: string;
  readonly onChange: (state: string) => void;
  readonly className?: string;
}

/**
 * Searchable picker over the fixed list of Nigerian states, so addresses and
 * vendors always carry the same spelling (the home page filters on it).
 * Typing narrows the list ("la" → Lagos); Enter/click picks; the field can
 * only ever hold a real state, never the half-typed text.
 */
export function StateSelect({ id, name, value, onChange, className }: StateSelectProps) {
  const listId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const open = query !== null;

  const matches = useMemo(() => {
    const needle = (query ?? "").trim().toLowerCase();
    if (!needle) return NIGERIAN_STATES;
    // "Abuja" should find the FCT even though it's stored as "FCT".
    return NIGERIAN_STATES.filter((state) => stateLabel(state).toLowerCase().includes(needle));
  }, [query]);

  function pick(state: string) {
    onChange(state);
    setQuery(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setQuery("");
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault(); // never submit the surrounding form from the picker
      const choice = matches[active];
      if (choice) pick(choice);
    } else if (event.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active]}` : undefined}
        autoComplete="off"
        placeholder="Search for a state"
        value={open ? query : value ? stateLabel(value) : ""}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setQuery("");
          setActive(Math.max(0, NIGERIAN_STATES.findIndex((state) => state === value)));
        }}
        // Delayed so a click on an option lands before the list unmounts.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setQuery(null), 120);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full pr-9"
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-control border border-border bg-surface py-1 shadow-lg"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No matching state</li>}
          {matches.map((state, index) => (
            <li
              key={state}
              id={`${listId}-${state}`}
              role="option"
              aria-selected={state === value}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(state);
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-3 py-2 text-sm text-ink ${
                index === active ? "bg-brand-50" : ""
              } ${state === value ? "font-semibold" : ""}`}
            >
              {stateLabel(state)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
