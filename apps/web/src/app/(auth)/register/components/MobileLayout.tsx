// components/MobileLayout.tsx
import Image from "next/image";
import Link from "next/link";
import { BackButton } from "./BackButton";
import { RegisterForm } from "../../_components/RegisterForm";

export function MobileLayout() {
  return (
    <div className="flex flex-1 flex-col lg:hidden">
      <header className="flex h-14 w-full items-center px-2">
        <BackButton />
      </header>

      <div className="flex-1 px-4 pb-8">
        {/* Hero: "Join" + Logo */}
        <div className="pb-8">
          <div className="flex items-center gap-1">
            <h1 className="font-sora text-[28px] font-bold leading-[34px] text-[#B61913]">
              Join
            </h1>
            <div className="h-[41px] w-[81px]">
              <Image
                src="/assets/logo-full.png"
                alt="KiaKia"
                width={81}
                height={41}
                className="h-full w-full object-contain"
              />
            </div>
          </div>
          <p className="mt-2 font-inter text-base leading-6 text-[#5B403C]">
            Create an account to get started.
          </p>
        </div>

        {/* Mobile Form - Uses existing RegisterForm with mobile styles */}
        <div className="[&_input]:h-12 [&_input]:rounded-xl [&_input]:border-[#E4BEB8] [&_input]:bg-[#FCF9F8] [&_input]:px-4 [&_input]:font-inter [&_input]:text-base [&_input]:text-[#5B403C] [&_input]:placeholder:text-[rgba(91,64,60,0.5)] [&_input]:focus:border-[#B61913] [&_input]:focus:ring-2 [&_input]:focus:ring-[#B61913]/20 [&_label]:font-inter [&_label]:text-sm [&_label]:font-semibold [&_label]:leading-5 [&_label]:tracking-[0.14px] [&_label]:text-[#1C1B1B] [&_button[type=submit]]:h-14 [&_button[type=submit]]:w-full [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:bg-[#B61913] [&_button[type=submit]]:font-inter [&_button[type=submit]]:text-sm [&_button[type=submit]]:font-semibold [&_button[type=submit]]:leading-5 [&_button[type=submit]]:tracking-[0.14px] [&_button[type=submit]]:text-white [&_button[type=submit]]:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] [&_button[type=submit]]:transition-all hover:[&_button[type=submit]]:bg-[#9e1611] active:[&_button[type=submit]]:scale-[0.98]">
          <RegisterForm />
        </div>

        {/* Mobile Footer */}
        <div className="mt-6">
          <p className="text-center font-inter text-base leading-6 text-[#5B403C]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#B61913] hover:underline"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
