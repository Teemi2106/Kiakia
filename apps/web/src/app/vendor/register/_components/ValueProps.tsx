// app/(vendor)/register/_components/ValueProps.tsx
import { Rocket, Shield } from "lucide-react";

export function ValueProps() {
  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E5E2E1]">
          <Rocket className="size-5 text-[#B61913]" />
        </div>
        <div>
          <h3 className="font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-[#1C1B1B]">
            Fast Onboarding
          </h3>
          <p className="font-inter text-sm leading-6 text-[#5B403C]">
            Start selling in minutes.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E5E2E1]">
          <Shield className="size-5 text-[#176A22]" />
        </div>
        <div>
          <h3 className="font-inter text-sm font-semibold leading-5 tracking-[0.01em] text-[#1C1B1B]">
            Secure Payments
          </h3>
          <p className="font-inter text-sm leading-6 text-[#5B403C]">
            Escrow protection for every order.
          </p>
        </div>
      </div>
    </div>
  );
}