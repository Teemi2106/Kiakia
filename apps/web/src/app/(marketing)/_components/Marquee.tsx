// app/(marketing)/_components/Marquee.tsx

// Rendered twice back to back; the keyframe translates exactly -50%, so the
// second copy is in the first copy's place when the loop restarts.
const CLAIMS = [
  "Escrow on every order",
  "Fast. Fresh. Reliable.",
  "4-digit handoff code",
  "Live rider tracking",
  "No batching, ever",
  "Vendors paid on delivery",
  "Kia kia — quick quick",
] as const;

function Band() {
  return (
    <div className="kk-marquee">
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1 || undefined}>
          {CLAIMS.map((claim) => (
            <span key={claim} className="flex items-center">
              <span className="whitespace-nowrap px-6 font-sora text-sm font-bold uppercase tracking-[0.18em] text-kk-cream sm:text-base">
                {claim}
              </span>
              <Star />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Star() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-kk-orange" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 0c.6 5.9 6.1 11.4 12 12-5.9.6-11.4 6.1-12 12-.6-5.9-6.1-11.4-12-12C5.9 11.4 11.4 5.9 12 0Z"
      />
    </svg>
  );
}

export function Marquee() {
  return (
    <section className="relative overflow-hidden bg-kk-ink-deep py-6 sm:py-7" aria-label="What KiaKia guarantees">
      <div className="-ml-[4%] w-[108%] -rotate-[1.2deg]">
        <Band />
      </div>
    </section>
  );
}
