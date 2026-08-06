// components/DesktopLayout.tsx
import Link from "next/link";
import { RegisterForm } from "../../_components/RegisterForm";

export function DesktopLayout() {
  return (
    <div className="hidden w-full max-w-[440px] px-4 py-8 lg:block">
      <div className="rounded-xl border border-[#E5E2E1] bg-white p-10 shadow-[0px_4px_24px_rgba(26,26,26,0.04)]">
        {/* Header */}
        <div className="mb-8 space-y-2">
          <h1 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-[#1C1B1B]">
            Create an Account
          </h1>
          <p className="font-inter text-base leading-6 text-[#5B403C]">
            Enter your details to get started with KiaKia.
          </p>
        </div>

        {/* Desktop Form - Uses existing RegisterForm with desktop styles */}
        <div className="[&_input]:h-[53px] [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[#E5E2E1] [&_input]:bg-[#FCF9F8] [&_input]:pl-9 [&_input]:pr-3 [&_input]:font-inter [&_input]:text-base [&_input]:text-[#5B403C] [&_input]:placeholder:text-[rgba(91,64,60,0.5)] [&_input]:focus:border-[#B61913] [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-[#B61913]/20 [&_label]:block [&_label]:font-inter [&_label]:text-sm [&_label]:font-semibold [&_label]:leading-5 [&_label]:tracking-[0.14px] [&_label]:text-[#1C1B1B] [&_label]:mb-1.5 [&_.lucide]:text-[#5B403C] [&_button[type=submit]]:flex [&_button[type=submit]]:h-[52px] [&_button[type=submit]]:w-full [&_button[type=submit]]:items-center [&_button[type=submit]]:justify-center [&_button[type=submit]]:gap-2 [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:bg-[#B61913] [&_button[type=submit]]:font-inter [&_button[type=submit]]:text-sm [&_button[type=submit]]:font-semibold [&_button[type=submit]]:leading-5 [&_button[type=submit]]:tracking-[0.14px] [&_button[type=submit]]:text-white [&_button[type=submit]]:transition-all hover:[&_button[type=submit]]:bg-[#9e1611] active:[&_button[type=submit]]:scale-[0.98] [&_button[type=submit]_svg]:size-[13.33px]">
          <RegisterForm />
        </div>

        {/* Desktop Footer */}
        <div className="mt-6 space-y-4">
          <p className="text-center font-inter text-base leading-6 text-[#5B403C]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#B61913] underline"
            >
              Log in
            </Link>
          </p>
          <p className="text-center font-inter text-xs font-medium leading-4 text-[rgba(91,64,60,0.7)]">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
