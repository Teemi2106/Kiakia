"use client";

import { clientEnv } from "@/lib/env.client";
import { Loader2, MapPinOff } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { MapCell, MapRider } from "./FleetMapbox";

// Next 16 only allows `ssr: false` from a Client Component, and mapbox-gl cannot
// be server-rendered: this wrapper is that boundary, FleetMapbox.tsx the module.
const FleetMapbox = dynamic(() => import("./FleetMapbox"), {
  ssr: false,
  loading: () => <Message icon={<Loader2 className="size-5 animate-spin" />} text="Loading map…" />,
});

function Message({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-sunken px-6 text-center text-sm text-ink-muted">
      {icon}
      {text}
    </div>
  );
}

export function FleetMap({ cells, riders }: { cells: readonly MapCell[]; riders: readonly MapRider[] }) {
  return (
    <div className="h-[28rem] overflow-hidden rounded-card border border-border bg-surface-raised shadow-sm">
      {clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN ? (
        <FleetMapbox cells={cells} riders={riders} />
      ) : (
        <Message icon={<MapPinOff className="size-5" />} text="The map is not set up yet. The busiest areas are listed below." />
      )}
    </div>
  );
}
