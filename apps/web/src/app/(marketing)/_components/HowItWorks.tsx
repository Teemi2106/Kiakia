// components/marketing/HowItWorks.tsx
import { cn } from "@kiakia/ui";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";

type IconType = LucideIcon | string;

const STEPS: Array<{
  title: string;
  description: string;
  icon: IconType;
  accent: string;
  circleAccent: string;
}> = [
  {
    title: "Discover local flavors",
    description:
      "Browse hundreds of local restaurants and hidden gems right in your neighborhood.",
    icon: "/assets/step1-icon.png",
    accent: "bg-[rgba(182,25,19,0.1)] text-[#B61913]",
    circleAccent: "bg-[rgba(182,25,19,0.1)]",
  },
  {
    title: "Pay securely via escrow",
    description:
      "Your money is held safely in escrow until you confirm your food arrived as ordered.",
    icon: "/assets/step2-icon.png",
    accent: "bg-[rgba(254,142,39,0.2)] text-[#934B00]",
    circleAccent: "bg-[rgba(254,142,39,0.1)]",
  },
  {
    title: "Share code to release",
    description:
      "Give the vendor your unique 4-digit code to instantly release payment upon delivery.",
    icon: "/assets/step3-icon.png",
    accent: "bg-[rgba(53,132,57,0.2)] text-[#176A22]",
    circleAccent: "bg-[rgba(23,106,34,0.1)]",
  },
] as const;

// Helper component to render either PNG or Lucide icon
function StepIcon({ icon, className }: { icon: IconType; className?: string }) {
  if (typeof icon === "string") {
    // It's a PNG image path
    return (
      <div className="relative size-6">
        <Image src={icon} alt="Step icon" fill className="object-contain" />
      </div>
    );
  }

  // It's a Lucide icon component
  const IconComponent = icon;
  return <IconComponent className={cn("size-6", className)} />;
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="bg-[#FCF9F8] px-4 py-8 sm:px-6 sm:py-24"
    >
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-2 sm:mb-16">
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-[32px] sm:leading-10 sm:tracking-[-0.32px]">
            How KiaKia Works
          </h2>
          <p className="max-w-[426px] text-center font-inter text-base text-[#5B403C]">
            Simple, secure, and fast. The modern way to order food.
          </p>
        </div>

        {/* Mobile: Horizontal Scroll */}
        <div className="flex gap-4 overflow-x-auto pb-4 sm:hidden [-webkit-overflow-scrolling:touch]">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="min-w-[280px] rounded-2xl border border-[#E4BEB8] bg-white p-5 shadow-sm"
            >
              <div
                className={cn(
                  "mb-4 flex h-12 w-12 items-center justify-center rounded-xl",
                  step.accent,
                )}
              >
                <StepIcon icon={step.icon} />
              </div>
              <h3 className="font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-[#1C1B1B]">
                {i + 1}. {step.title}
              </h3>
              <p className="mt-1 font-inter text-base leading-[22px] text-[#5B403C]">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        {/* Desktop: Grid */}
        <div className="hidden grid-cols-3 gap-8 sm:grid">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col items-center rounded-2xl border border-[#F0EDED] bg-white px-6 pb-12 pt-6"
            >
              <div
                className={cn(
                  "mb-6 flex h-16 w-16 items-center justify-center rounded-full",
                  step.circleAccent,
                )}
              >
                <StepIcon icon={step.icon} className="text-[#B61913]" />
              </div>
              <h3 className="mb-2 font-sora text-2xl font-semibold text-[#1C1B1B]">
                {i + 1}. {step.title}
              </h3>
              <p className="max-w-[315px] text-center font-inter text-base leading-6 text-[#5B403C]">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
