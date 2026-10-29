// app/(marketing)/_components/Assurance.tsx
import { MapPinned, Store } from "lucide-react";
import { Reveal } from "./Reveal";

/**
 * The whole trust story, in one slim band.
 *
 * This replaced a full-bleed section that walked through the payment flow
 * step by step, complete with a receipt and a code stamp. It answered a
 * question nobody arrives with: someone landing here is hungry, not auditing
 * us. Three short lines are enough to settle it in passing, and the FAQ is
 * there for anyone who genuinely wants the mechanics.
 */
const ASSURANCES = [
  {
    icon: MapPinned,
    title: "You can see the whole trip",
    body: "Live map from the kitchen to your door, so you know exactly when to get up and answer it.",
    tint: "bg-kk-orange/20 text-kk-orange",
  },
  {
    icon: Store,
    title: "Real kitchens only",
    body: "Every vendor is checked before they can take a single order. No ghost listings, no guessing.",
    tint: "bg-white/10 text-white",
  },
] as const;

export function Assurance() {
  return (
    <section
      id="assurance"
      className="relative scroll-mt-24 overflow-hidden bg-kk-ink-deep px-4 py-14 sm:px-6 sm:py-16 lg:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="kk-grid absolute inset-0 text-white/5" />
        <div className="kk-blob -right-24 -top-20 size-[380px] bg-kk-red/25" />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-8 md:grid-cols-2 md:gap-10">
        {ASSURANCES.map((item, i) => (
          <Reveal key={item.title} delay={i * 100}>
            <div className="flex gap-4">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-white/15 ${item.tint}`}
              >
                <item.icon className="size-5" />
              </span>
              <div>
                <h2 className="font-sora text-base font-bold text-white">{item.title}</h2>
                <p className="mt-1.5 max-w-xs font-inter text-[14px] leading-6 text-white/55">
                  {item.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
