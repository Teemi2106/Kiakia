"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { Map, Marker, type MapRef } from "react-map-gl/mapbox";
import type { LatLng } from "@kiakia/domain";
import { clientEnv } from "@/lib/env.client";

export default function AddressPreviewMapCanvas({ point, onChange }: { point: LatLng; onChange: (point: LatLng) => void }) {
  const mapRef = useRef<MapRef | null>(null);

  useEffect(() => {
    mapRef.current?.easeTo({ center: [point.lng, point.lat], zoom: 15, duration: 500 });
  }, [point.lat, point.lng]);

  function placePin(event: { lngLat: { lat: number; lng: number } }) {
    onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  }

  return (
    <Map
      ref={mapRef}
      reuseMaps
      mapboxAccessToken={clientEnv.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ longitude: point.lng, latitude: point.lat, zoom: 15 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      onClick={placePin}
    >
      <Marker
        longitude={point.lng}
        latitude={point.lat}
        anchor="bottom"
        draggable
        onDragEnd={(event) => {
          const next = event.target.getLngLat();
          onChange({ lat: next.lat, lng: next.lng });
        }}
      >
        <div className="relative flex size-12 cursor-grab items-center justify-center drop-shadow-[0_8px_10px_rgba(91,22,18,0.35)] active:cursor-grabbing" aria-label="Drag to adjust delivery pin">
          <svg viewBox="0 0 48 56" className="absolute inset-0 size-full" aria-hidden="true">
            <defs>
              <linearGradient id="kiakia-pin-gradient" x1="8" y1="4" x2="40" y2="49" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF762E" />
                <stop offset="1" stopColor="#B61913" />
              </linearGradient>
            </defs>
            <path d="M24 2C11.85 2 2 11.55 2 23.32c0 15.3 18.64 29.52 20.72 31.07a2.1 2.1 0 0 0 2.56 0C27.36 52.84 46 38.62 46 23.32 46 11.55 36.15 2 24 2Z" fill="url(#kiakia-pin-gradient)" stroke="white" strokeWidth="2.5" />
            <circle cx="24" cy="23" r="10" fill="white" />
            <circle cx="24" cy="23" r="5" fill="#C21F18" />
          </svg>
          <span className="sr-only">Delivery location pin</span>
        </div>
      </Marker>
    </Map>
  );
}
