// app/_components/RiderRoute.tsx
"use client";

import { useEffect, useState } from "react";

// One S-curve, bottom-left to top-right. The rider and the dashes share it, so
// the scooter always rides exactly the line that is drawn.
const ROUTE = "M 44 268 C 170 262, 292 236, 252 176 C 214 120, 96 148, 196 74";
const PIN = { x: 196, y: 74 };

/**
 * A scooter riding a dashed road to a pin, on a loop. Pure SVG (SMIL
 * animateMotion), so it needs no map, token or data and is safe to drop into
 * loading and empty states as well as marketing pages.
 *
 * With prefers-reduced-motion the rider parks part-way along the road instead
 * of moving; the picture still reads, it just holds still.
 */
export function RiderRoute({
  label,
  className,
}: {
  /** Short name for the destination, shown beside the pin (e.g. "Osogbo"). */
  label?: string;
  className?: string;
}) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <svg
      viewBox="0 0 320 320"
      role="img"
      aria-label={label ? `A rider on the way to ${label}` : "A rider on the way"}
      className={className}
    >
      <path
        d={ROUTE}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="14 14"
        className="text-kk-ink/80"
      />

      {/* Destination pin. The ring pulses so the end of the road is the
          thing the eye is pulled towards. */}
      <g transform={`translate(${PIN.x} ${PIN.y})`}>
        {!reduced && (
          <circle r="10" className="fill-kk-red/25">
            <animate attributeName="r" values="10;26" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
          </circle>
        )}
        <path
          d="M0 0 C-14 -16 -22 -26 -22 -38 A22 22 0 1 1 22 -38 C22 -26 14 -16 0 0 Z"
          className="fill-kk-red"
        />
        <circle cy="-38" r="8" className="fill-white" />
      </g>
      {label && (
        <text
          x={PIN.x + 30}
          y={PIN.y - 34}
          className="fill-kk-ink font-sora text-[15px] font-bold uppercase tracking-widest"
        >
          {label}
        </text>
      )}

      {/* Rider: wheels, floor, body, helmeted head, delivery box. Drawn around
          its own origin so animateMotion places the wheelbase on the road. */}
      <g transform={reduced ? "translate(150 258)" : undefined}>
        <g transform="translate(-28 -44)">
          <path d="M-18 14 h-16 M-14 22 h-12 M-10 30 h-8" className="stroke-kk-ink" strokeWidth="3" strokeLinecap="round" />
          <rect x="-6" y="0" width="22" height="20" rx="4" className="fill-kk-ink" />
          <circle cx="30" cy="-4" r="7" className="fill-kk-ink" />
          <path d="M18 8 q10 -4 16 4 l8 14 h-26 z" className="fill-kk-ink" />
          <path d="M6 30 h40 l8 10 h-52 z" className="fill-kk-ink" />
          <rect x="14" y="33" width="26" height="6" rx="3" className="fill-kk-orange" />
          <circle cx="2" cy="50" r="9" className="fill-kk-ink" />
          <circle cx="2" cy="50" r="3.5" className="fill-kk-cream" />
          <circle cx="50" cy="50" r="9" className="fill-kk-ink" />
          <circle cx="50" cy="50" r="3.5" className="fill-kk-cream" />
        </g>
        {!reduced && (
          <animateMotion
            path={ROUTE}
            dur="6s"
            repeatCount="indefinite"
            calcMode="spline"
            keyPoints="0;1"
            keyTimes="0;1"
            keySplines="0.5 0 0.2 1"
          />
        )}
      </g>
    </svg>
  );
}
