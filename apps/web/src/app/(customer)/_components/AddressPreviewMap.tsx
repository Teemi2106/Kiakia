"use client";

import dynamic from "next/dynamic";
import { MapPinOff } from "lucide-react";
import type { LatLng } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";

const MapPreview = dynamic(() => import("./AddressPreviewMapCanvas"), {
  ssr: false,
  loading: () => <MapMessage message="Loading map…" />,
});

function MapMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 bg-kk-sand px-5 text-center font-inter text-sm text-kk-cocoa">
      <MapPinOff className="size-5" />
      <span>{message}</span>
    </div>
  );
}

export function AddressPreviewMap({ point, onChange }: { point: LatLng; onChange: (point: LatLng) => void }) {
  if (!clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN) return <MapMessage message="Map preview is unavailable right now." />;
  return <MapPreview point={point} onChange={onChange} />;
}
