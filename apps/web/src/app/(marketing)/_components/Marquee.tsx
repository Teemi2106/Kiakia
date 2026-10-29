// app/(marketing)/_components/Marquee.tsx

// Two bands running opposite ways. The top one is what you could be eating;
// the bottom one is what we do about it. Each band is rendered twice back to
// back, and the keyframe translates exactly -50%, so the second copy is in
// the first copy's place when the loop restarts.
const CRAVINGS = [
  "Jollof still steaming",
  "Suya off the grill",
  "Shawarma at 11pm",
  "Pounded yam & egusi",
  "Peppered chicken",
  "Puff-puff by the dozen",
  "Chapman, cold",
] as const;

const PROMISES = [
  "KiaKia means fast fast",
  "Kitchens on your street",
  "Live rider tracking",
  "No batching, ever",
  "Hot when it reaches you",
] as const;

function Band({ items, reverse }: { items: readonly string[]; reverse?: boolean }) {
  return (
    <div className={`kk-marquee${reverse ? " kk-marquee-reverse" : ""}`}>
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1 || undefined}>
          {items.map((item) => (
            <span key={item} className="flex items-center">
              <span className="whitespace-nowrap px-6 font-sora text-sm font-bold uppercase tracking-[0.18em] text-kk-cream sm:text-base">
                {item}
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
    <section
      className="relative overflow-hidden bg-kk-ink-deep py-6 sm:py-7"
      aria-label="What you can order on KiaKia"
    >
      <div className="-ml-[4%] w-[108%] -rotate-[1.2deg] space-y-3">
        <Band items={CRAVINGS} />
        <div className="opacity-45">
          <Band items={PROMISES} reverse />
        </div>
      </div>
    </section>
  );
}
