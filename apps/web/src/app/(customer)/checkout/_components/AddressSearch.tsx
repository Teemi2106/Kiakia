"use client";

import { MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AddressSearchResult } from "@/lib/geo/search-addresses";
import { searchAddresses } from "@/lib/geo/search-addresses";

export function AddressSearch({ onSelect }: { onSelect: (result: AddressSearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectedLabelRef = useRef<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const term = query.trim();
    if (selectedLabelRef.current === term) {
      selectedLabelRef.current = null;
      return;
    }
    if (term.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setResults([]);
      try {
        const found = await searchAddresses(term, controller.signal);
        if (controller.signal.aborted) return;
        setResults(found);
        if (found.length === 0) setError("No Nigerian addresses found. Try a street, area or city name.");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not search addresses.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-kk-cocoa/70" />
          <input
            value={query}
            onChange={(event) => {
              selectedLabelRef.current = null;
              setQuery(event.target.value);
              setResults([]);
              setLoading(false);
              setError(null);
            }}
            placeholder="Search street, area or city"
            aria-label="Search delivery area"
            className="h-11 w-full rounded-xl border border-kk-hair bg-kk-card pl-10 pr-3 font-inter text-sm text-kk-ink placeholder:text-kk-cocoa/60 focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red/20"
          />
        </label>
        {loading && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-inter text-xs text-kk-cocoa">Searching…</span>}
      </div>
      <p className="font-inter text-xs text-kk-cocoa">Search for an area, street or landmark. Results appear as you type.</p>
      {error && <p role="status" className="font-inter text-xs text-kk-cocoa">{error}</p>}
      {results.length > 0 && (
        <ul className="max-h-52 divide-y divide-kk-hair overflow-y-auto rounded-xl border border-kk-hair bg-kk-card">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectRef.current(result);
                  setResults([]);
                  selectedLabelRef.current = result.label.trim();
                  setQuery(result.label);
                }}
                className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-kk-sand"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
                <span className="font-inter text-sm text-kk-ink">{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
