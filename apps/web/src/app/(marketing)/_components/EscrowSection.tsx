// components/marketing/EscrowSection.tsx
import Image from "next/image";
import { Icon } from "./StepIcon";

const ESCROW_DIGITS = ["4", "0", "9", "1"];

export function EscrowSection() {
  return (
    <section className="bg-[#F6F3F2] px-4 py-6 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:gap-12">
          {/* Content */}
          <div className="flex flex-1 flex-col items-center gap-4 text-center sm:items-start sm:text-left">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#A3F69D] px-3 py-1">
              <Icon icon="/assets/escroll-Icon.png" size={3} />
              <span className="font-inter text-xs font-medium leading-4 text-[#005313]">
                Buyer &amp; Seller Protocol
              </span>
            </div>
            <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B] sm:text-[32px] sm:leading-10 sm:tracking-[-0.32px]">
              Zero-Trust Delivery Protocol
            </h2>
            <p className="max-w-[592px] font-inter text-base leading-6 text-[#5B403C] sm:text-[18px] sm:leading-7">
              Our unique 4-digit escrow code system guarantees that customers
              only pay when they get their food, and vendors are guaranteed
              payment upon successful handoff.
            </p>
            <div className="mt-4 w-full">
              <p className="mb-4 font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-[#1C1B1B]">
                How it looks on delivery:
              </p>
              <div className="flex gap-4">
                {ESCROW_DIGITS.map((digit) => (
                  <div
                    key={digit}
                    className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-[#906F6B] bg-white sm:h-[64px] sm:w-[64px]"
                  >
                    <span className="font-sora text-[32px] font-extrabold leading-10 tracking-[-0.96px] text-[#1C1B1B] sm:text-[48px] sm:leading-[56px]">
                      {digit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Image */}
          <div className="w-full flex-1 sm:max-w-[592px]">
            <div className="aspect-[592/323] w-full overflow-hidden rounded-2xl shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)]">
              <Image
                src="/assets/zero-trust.png"
                alt="A secure package with a digital lock"
                width={592}
                height={323}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
