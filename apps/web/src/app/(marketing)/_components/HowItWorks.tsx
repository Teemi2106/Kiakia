import Image from "next/image";
import { Bike, Check, DoorOpen, Plus, ShoppingBag } from "lucide-react";

const STEPS = [
  {
    number: "01",
    label: "ORDER",
    title: "Choose what sounds good.",
    body: "Browse nearby menus and place an order.",
  },
  {
    number: "02",
    label: "CONFIRMATION",
    title: "The vendor confirms.",
    body: "They've got your order.",
  },
  {
    number: "03",
    label: "PICKUP",
    title: "A rider picks it up.",
    body: "Your meal leaves the restaurant with a KiaKia rider.",
  },
  {
    number: "04",
    label: "DELIVERY",
    title: "Time to eat.",
    body: "Your order arrives at your door.",
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 bg-kk-sand px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <div>
            <p className="font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              How it works
            </p>
            <h2 className="mt-4 max-w-2xl font-sora text-[clamp(2.2rem,5vw,4.25rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-kk-ink">
              From the menu to your door.
            </h2>
          </div>
          <p className="max-w-sm pb-1 font-inter text-base leading-7 text-kk-cocoa sm:text-[17px]">
            Here&apos;s what happens after you place an order.
          </p>
        </div>

        <ol className="mt-12 grid gap-x-8 gap-y-14 sm:mt-16 md:grid-cols-12 md:gap-y-20">
          <li className="md:col-span-7">
            <figure className="relative aspect-[1.12] overflow-hidden rounded-[28px] bg-kk-line sm:aspect-[1.5]">
              <Image
                src="/assets/demo-menu/jollof-grill.jpg"
                alt="Jollof rice with grilled chicken and plantain"
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-cover"
              />
              <span className="absolute left-4 top-4 rounded-full bg-kk-cream/95 px-3.5 py-2 font-inter text-[11px] font-semibold uppercase tracking-[0.14em] text-kk-ink shadow-sm sm:left-6 sm:top-6">
                On the menu
              </span>
              <div className="absolute inset-x-4 bottom-4 flex justify-end sm:inset-x-6 sm:bottom-6">
                <div className="flex max-w-[min(100%,19rem)] items-center gap-4 rounded-2xl bg-kk-cream p-3.5 shadow-[0_18px_45px_-18px_rgba(28,27,27,0.5)] sm:gap-5 sm:p-4">
                  <div className="min-w-0">
                    <p className="truncate font-sora text-[15px] font-bold text-kk-ink sm:text-base">
                      Jollof, chicken & plantain
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-kk-red text-white"
                  >
                    <Plus className="size-5" strokeWidth={2.5} />
                  </span>
                </div>
              </div>
            </figure>
            <StepCaption step={STEPS[0]} />
          </li>

          <li className="md:col-span-5 md:mt-20">
            <figure className="relative aspect-[1.12] overflow-hidden rounded-[28px] bg-kk-line sm:aspect-[1.2] md:aspect-[1.18]">
              <Image
                src="/assets/demo-menu/egusi-pounded-yam.jpg"
                alt="Egusi soup with pounded yam"
                fill
                sizes="(max-width: 768px) 100vw, 42vw"
                className="object-cover"
              />
              <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-kk-cream p-4 shadow-[0_18px_45px_-18px_rgba(28,27,27,0.5)] sm:inset-x-5 sm:bottom-5 sm:p-5">
                <p className="font-inter text-[10px] font-semibold uppercase tracking-[0.16em] text-kk-cocoa">
                  Your order
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-kk-green/10 text-kk-green">
                    <Check className="size-5" strokeWidth={2.5} />
                  </span>
                  <p className="font-sora text-base font-bold text-kk-ink sm:text-lg">
                    Confirmed by the vendor
                  </p>
                </div>
              </div>
            </figure>
            <StepCaption step={STEPS[1]} />
          </li>

          <li className="md:col-span-5">
            <figure
              role="img"
              aria-label="Illustration of a KiaKia rider collecting an order"
              className="relative flex aspect-[1.12] items-center justify-center overflow-hidden rounded-[28px] bg-kk-red sm:aspect-[1.2] md:aspect-[1.18]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 560 420"
                className="absolute inset-0 size-full"
                fill="none"
              >
                <path
                  d="M-18 295C77 209 125 208 209 273c84 66 150 66 241-19 45-42 82-53 128-34"
                  stroke="white"
                  strokeOpacity=".28"
                  strokeWidth="3"
                  strokeDasharray="7 11"
                />
              </svg>
              <span
                aria-hidden="true"
                className="absolute -right-12 -top-16 size-60 rounded-full bg-kk-orange"
              />
              <div aria-hidden="true" className="relative -translate-x-2 text-kk-cream">
                <Bike className="size-36 sm:size-44" strokeWidth={1.1} />
                <span className="absolute -right-5 -top-3 flex size-14 items-center justify-center rounded-xl bg-kk-cream text-kk-red shadow-lg ring-4 ring-kk-red sm:size-16">
                  <ShoppingBag className="size-8" strokeWidth={1.6} />
                </span>
              </div>
              <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-kk-ink px-3.5 py-2 font-inter text-[11px] font-semibold uppercase tracking-[0.14em] text-white sm:bottom-6 sm:left-6">
                <Bike className="size-4" />
                Rider pickup
              </span>
            </figure>
            <StepCaption step={STEPS[2]} />
          </li>

          <li className="md:col-span-7 md:mt-4">
            <figure className="relative aspect-[1.12] overflow-hidden rounded-[28px] bg-kk-line sm:aspect-[1.5]">
              <Image
                src="/assets/demo-menu/suya-plantain.jpg"
                alt="Suya with ripe grilled plantain"
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-cover"
              />
              <span className="absolute right-4 top-4 flex size-12 items-center justify-center rounded-full bg-kk-cream text-kk-red shadow-md sm:right-6 sm:top-6 sm:size-14">
                <DoorOpen className="size-6 sm:size-7" strokeWidth={1.7} />
              </span>
              <span className="absolute bottom-4 left-4 rounded-full bg-kk-cream/95 px-3.5 py-2 font-inter text-[11px] font-semibold uppercase tracking-[0.14em] text-kk-ink shadow-sm sm:bottom-6 sm:left-6">
                At your door
              </span>
            </figure>
            <StepCaption step={STEPS[3]} />
          </li>
        </ol>
      </div>
    </section>
  );
}

function StepCaption({
  step,
}: {
  step: (typeof STEPS)[number];
}) {
  return (
    <div className="mt-5 flex gap-4 sm:mt-6 sm:gap-5">
      <span className="pt-1 font-mono text-sm font-semibold text-kk-red">{step.number}</span>
      <div>
        <p className="font-inter text-[10px] font-semibold uppercase tracking-[0.18em] text-kk-cocoa">
          {step.label}
        </p>
        <h3 className="mt-1.5 font-sora text-xl font-bold tracking-tight text-kk-ink sm:text-2xl">
          {step.title}
        </h3>
        <p className="mt-2 max-w-sm font-inter text-[15px] leading-7 text-kk-cocoa">
          {step.body}
        </p>
      </div>
    </div>
  );
}
