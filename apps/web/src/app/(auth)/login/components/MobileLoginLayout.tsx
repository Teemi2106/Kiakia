// components/MobileLoginLayout.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { LoginForm } from "../../_components/LoginForm";

function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/")}
      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5"
      aria-label="Go back"
    >
      <ChevronLeft className="size-4 text-[#1C1B1B]" />
    </button>
  );
}

export function MobileLoginLayout() {
  return (
    <div className="flex flex-1 flex-col lg:hidden">
      {/* Header with Back Button */}
      <header className="flex h-14 w-full items-center px-4">
        <BackButton />
      </header>

      <div className="flex-1 px-4 pb-8">
        {/* Hero Section */}
        <div className="flex flex-col items-center pb-8">
          {/* Logo */}
          <div className="h-[122px] w-[128px]">
            <Image
              src="/assets/sec-logo.png"
              alt="KiaKia"
              width={128}
              height={122}
              className="h-full w-full object-contain"
            />
          </div>

          {/* Heading */}
          <h1 className="mt-2 font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
            Welcome back
          </h1>

          {/* Subtitle */}
          <p className="mt-2 font-inter text-base leading-6 text-[#5B403C]">
            Enter your details to access your account.
          </p>
        </div>

        {/* Login Form with mobile styles */}
        <div className="[&_input]:h-[53px] [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[#E4BEB8] [&_input]:bg-white [&_input]:pl-9 [&_input]:pr-3 [&_input]:font-inter [&_input]:text-base [&_input]:text-[#5B403C] [&_input]:placeholder:text-[rgba(91,64,60,0.5)] [&_input]:focus:border-[#B61913] [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-[#B61913]/20 [&_label]:block [&_label]:font-inter [&_label]:text-sm [&_label]:font-semibold [&_label]:leading-5 [&_label]:tracking-[0.14px] [&_label]:text-[#1C1B1B] [&_label]:mb-1.5 [&_.lucide]:text-[#5B403C] [&_button[type=submit]]:flex [&_button[type=submit]]:h-[52px] [&_button[type=submit]]:w-full [&_button[type=submit]]:items-center [&_button[type=submit]]:justify-center [&_button[type=submit]]:gap-2 [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:bg-[#B61913] [&_button[type=submit]]:font-inter [&_button[type=submit]]:text-sm [&_button[type=submit]]:font-semibold [&_button[type=submit]]:leading-5 [&_button[type=submit]]:tracking-[0.14px] [&_button[type=submit]]:text-white [&_button[type=submit]]:shadow-[0_4px_6px_-1px_rgba(182,25,19,0.1),0_2px_4px_-2px_rgba(182,25,19,0.1)] [&_button[type=submit]]:transition-all hover:[&_button[type=submit]]:bg-[#9e1611] active:[&_button[type=submit]]:scale-[0.98] [&_button[type=submit]_svg]:size-[13.33px]">
          <LoginForm />
        </div>

        {/* Footer */}
        <div className="mt-2 pt-3.5">
          <p className="text-center font-inter text-base leading-6 text-[#5B403C]">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-[#B61913] hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
