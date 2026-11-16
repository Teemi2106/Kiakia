"use client";

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

const SWIPE_INTERVAL_MS = 3_400;
const USER_PAUSE_MS = 7_000;
const SWIPE_DISTANCE_PX = 96;

type AutoSwipeRailProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
};

/** Gives horizontal rails a small, repeating nudge while keeping them touch-scrollable. */
export function AutoSwipeRail({ children, ...props }: AutoSwipeRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let direction = 1;
    let pausedUntil = 0;

    const pauseForInteraction = () => {
      pausedUntil = Date.now() + USER_PAUSE_MS;
    };

    const swipeTimer = window.setInterval(() => {
      if (motionPreference.matches || Date.now() < pausedUntil) return;

      const maxScroll = rail.scrollWidth - rail.clientWidth;
      if (maxScroll <= 2) return;

      if (direction > 0 && rail.scrollLeft >= maxScroll - 2) direction = -1;
      else if (direction < 0 && rail.scrollLeft <= 2) direction = 1;

      rail.scrollBy({
        left: direction * Math.min(SWIPE_DISTANCE_PX, rail.clientWidth * 0.35),
        behavior: "smooth",
      });
    }, SWIPE_INTERVAL_MS);

    const interactionEvents = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    interactionEvents.forEach((eventName) =>
      rail.addEventListener(eventName, pauseForInteraction, { passive: true }),
    );

    return () => {
      window.clearInterval(swipeTimer);
      interactionEvents.forEach((eventName) =>
        rail.removeEventListener(eventName, pauseForInteraction),
      );
    };
  }, []);

  return <div ref={railRef} {...props}>{children}</div>;
}
