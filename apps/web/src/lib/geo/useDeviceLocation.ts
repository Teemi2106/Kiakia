"use client";

import type { LatLng } from "@kiakia/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { reverseGeocode, type ReversedAddress } from "./reverse-geocode";

interface Options {
  /** Ask for the position as soon as the component mounts, instead of waiting for a button press. */
  readonly auto?: boolean;
  /** Runs with the coordinates and, when it could be worked out, the address they resolve to. */
  readonly onFound: (coords: LatLng, address: ReversedAddress | null) => void;
}

const UNAVAILABLE = "Couldn't get your location. Please enable location access and try again.";
const INACCURATE = "Your location is too approximate to use. Move somewhere with a clearer GPS signal and try again, or place the pin manually.";
const OUTSIDE_SERVICE_AREA = "Your device reported a location outside Nigeria. Check your device location settings, or place the pin manually in Nigeria.";

export function useDeviceLocation({ auto = false, onFound }: Options) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The latest callback, without making `locate` change identity on every render.
  const onFoundRef = useRef(onFound);
  const autoStarted = useRef(false);
  useEffect(() => {
    onFoundRef.current = onFound;
  });

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError(UNAVAILABLE);
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (position.coords.accuracy > 2_000) {
          setError(INACCURATE);
          setLocating(false);
          return;
        }
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        // KiaKia currently serves Nigeria. Browser geolocation can return an
        // unexpected fix (for example, a stale or misconfigured device position).
        if (coords.lat < 4.2 || coords.lat > 13.9 || coords.lng < 2.6 || coords.lng > 14.7) {
          setError(OUTSIDE_SERVICE_AREA);
          setLocating(false);
          return;
        }
        const address = await reverseGeocode(coords);
        onFoundRef.current(coords, address);
        setLocating(false);
      },
      () => {
        setError(UNAVAILABLE);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (!auto) {
      autoStarted.current = false; // re-arm for the next time it turns on
      return;
    }
    if (autoStarted.current) return;
    autoStarted.current = true;
    locate();
  }, [auto, locate]);

  return { locate, locating, error };
}
