// app/(customer)/tracking/_components/MapArea.tsx
"use client";

interface MapAreaProps {
  variant?: "desktop" | "mobile";
  // Rider live location/ETA needs dispatch (Phase 3, not built yet — see
  // supabase/migrations/0002_identity.sql) so the rider marker/ETA callout
  // below is only ever shown when a rider is actually assigned to the
  // order, and even then only as a static "assigned" indicator, not a real
  // position — no coordinates are fabricated.
  hasRider?: boolean;
}

export function MapArea({ variant = "desktop", hasRider = false }: MapAreaProps) {
  const isDesktop = variant === "desktop";

  return (
    <div className={`relative ${isDesktop ? "flex-1" : "h-full w-full"}`}>
      {/* Map Background */}
      <div
        className={`h-full w-full bg-[#F6F3F2] ${isDesktop ? "" : "absolute inset-0"}`}
        style={{
          backgroundImage: "url('/assets/map-placeholder.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Overlay */}
        <div className="absolute inset-0 bg-[rgba(96,86,240,0.05)]" />
      </div>

      {/* Desktop Map Markers */}
      {isDesktop && (
        <>
          {/* Destination Marker */}
          <div className="absolute left-[56.52%] top-[26.35%]">
            <div className="relative flex flex-col items-center">
              <div className="rounded-lg border border-[#E4BEB8] bg-[#FCF9F8] px-3 py-1.5 shadow-lg">
                <span className="font-inter text-xs font-medium text-[#1C1B1B]">
                  Home
                </span>
              </div>
              <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[#E4BEB8] bg-[#FCF9F8]" />
              <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#E4BEB8] bg-[#FCF9F8] shadow-lg">
                <div className="h-3 w-2.5 bg-[#5B403C]" />
              </div>
            </div>
          </div>

          {/* Rider Marker — no live position/ETA exists yet (Phase 3), so
              this is only ever shown as a static "rider assigned"
              indicator, never with a fabricated distance/time. */}
          {hasRider && (
            <div className="absolute left-[34.5%] top-[41.04%]">
              <div className="relative flex flex-col items-center">
                <div className="rounded-lg bg-[#B61913] px-3 py-1.5 shadow-lg">
                  <span className="font-inter text-xs font-bold text-white">
                    Rider assigned
                  </span>
                </div>
                <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-[#B61913]" />
                <div className="mt-2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#FCF9F8] bg-[#B61913] shadow-lg">
                  <div className="h-3 w-5 bg-white" />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Mobile Map Markers */}
      {!isDesktop && (
        <>
          {/* Origin Marker (Restaurant) */}
          <div className="absolute left-[159.5px] top-[28.19px]">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#B61913] bg-[#FCF9F8] shadow-lg">
              <div className="h-2.5 w-3.5 bg-[#B61913]" />
            </div>
          </div>

          {/* Destination Marker (Home) */}
          <div className="absolute left-[175px] top-[687.19px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#DCD9D9] bg-[#E5E2E1] shadow-lg">
              <div className="h-3.5 w-4 bg-[#5B403C]" />
            </div>
          </div>

          {/* Rider Blinker — same "assigned, no fabricated position" rule
              as the desktop marker above. */}
          {hasRider && (
            <div className="absolute left-[151.5px] top-[329.59px]">
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-[#B61913] opacity-40" />
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#FCF9F8] bg-[#B61913] shadow-lg">
                  <div className="h-2.5 w-4 bg-white" />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
