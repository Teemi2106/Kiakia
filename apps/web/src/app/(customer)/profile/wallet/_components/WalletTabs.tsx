"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

export type WalletTab = {
  id: string;
  label: string;
  /** Small count shown next to the label, e.g. pending requests. */
  badge?: number;
  panel: ReactNode;
};

export function WalletTabs({ tabs }: { tabs: WalletTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Wallet history"
        className="flex gap-1 rounded-2xl bg-kk-fill p-1"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${base}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 font-inter text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-kk-red-ink ${
                selected
                  ? "bg-kk-card text-kk-ink shadow-sm"
                  : "text-kk-cocoa hover:text-kk-ink"
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span className="rounded-full bg-kk-red px-1.5 py-0.5 font-inter text-[11px] font-bold leading-none text-white">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="mt-5"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
