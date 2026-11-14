"use client";

import { MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AddressSearchResult } from "@/lib/geo/search-addresses";
import { searchAddresses } from "@/lib/geo/search-addresses";
import { clientEnv } from "@/lib/env.client";

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
            className="h-13 w-full rounded-2xl border border-kk-hair bg-white pl-11 pr-3 font-inter text-sm text-kk-ink shadow-[0_6px_18px_-16px_rgba(40,28,24,0.45)] transition focus:border-kk-red/50 focus:outline-none focus:ring-4 focus:ring-kk-red/10 placeholder:text-kk-cocoa/55"
          />
        </label>
        {loading && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-inter text-xs text-kk-cocoa">Searching…</span>}
      </div>
      <p className="font-inter text-xs leading-5 text-kk-cocoa/80">Search a Nigerian street, neighbourhood or landmark.</p>
      {clientEnv.NEXT_PUBLIC_GEOAPIFY_API_KEY ? (
        <p className="pt-1 font-inter text-[10px] leading-4 text-kk-cocoa/55">
          <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">Geoapify</a>
          {" · "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-2">© OpenStreetMap contributors</a>
        </p>
      ) : null}
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
                className="group flex w-full items-start gap-3 px-3 py-3.5 text-left transition-colors hover:bg-kk-sand/75"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red-ink transition-colors group-hover:bg-kk-red/15">
                  <MapPin className="size-4" />
                </span>
                <span className="pt-1 font-inter text-sm leading-5 text-kk-ink">{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
