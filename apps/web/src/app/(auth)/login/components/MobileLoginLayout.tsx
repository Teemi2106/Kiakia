// components/MobileLoginLayout.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { LoginForm } from "../../_components/LoginForm";
import { OAuthButtons } from "../../_components/OAuthButtons";

function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
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

        {/* Divider with OR */}
        <div className="flex items-center gap-4 py-8">
          <div className="h-px flex-1 bg-[rgba(228,190,184,0.5)]" />
          <span className="font-inter text-xs font-medium uppercase tracking-[0.6px] text-[#5B403C]">
            OR
          </span>
          <div className="h-px flex-1 bg-[rgba(228,190,184,0.5)]" />
        </div>

        {/* Social Login Buttons */}
        <div className="space-y-4">
          <button className="relative flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-[#E4BEB8] bg-white font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-[#1C1B1B] transition-all hover:bg-gray-50 active:scale-[0.98]">
            {/* Google Icon - SVG placeholder */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M19.6 10.23c0-.82-.07-1.42-.22-2.05H10v3.72h5.5c-.11.9-.71 2.25-2.04 3.16l-.02.12 2.96 2.3.2.02c1.85-1.71 2.92-4.23 2.92-7.27z"
                fill="#4285F4"
              />
              <path
                d="M10 20c2.64 0 4.86-.87 6.48-2.37l-3.09-2.4c-.83.58-1.93.98-3.39.98-2.59 0-4.79-1.71-5.57-4.08l-.11.01-3.02 2.34-.04.1C2.54 16.64 5.99 20 10 20z"
                fill="#34A853"
              />
              <path
                d="M4.43 12.13a6.02 6.02 0 0 1 0-4.26v-.12L1.4 5.4l-.09.04a9.95 9.95 0 0 0 0 9.12l3.12-2.43z"
                fill="#FBBC05"
              />
              <path
                d="M10 3.58c1.83 0 3.07.79 3.78 1.45l2.76-2.7C14.86.9 12.64 0 10 0 5.99 0 2.54 3.36 1.31 7.7l3.11 2.42C5.21 5.29 7.41 3.58 10 3.58z"
                fill="#EA4335"
              />
            </svg>
            <span>Google</span>
          </button>

          <button className="relative flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-[#E4BEB8] bg-white font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-[#1C1B1B] transition-all hover:bg-gray-50 active:scale-[0.98]">
            {/* Apple Icon - SVG placeholder */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M13.78 1.94c.65-.79 1.47-1.35 2.42-1.94.02.75-.25 1.46-.67 2.05-.46.65-1.05 1.13-1.79 1.58-.68.42-1.45.73-2.3.84-.02-.78.27-1.48.7-2.08.41-.57.98-1.08 1.64-1.45zM9.5 3.06c-1.31 0-2.45-.75-3.76-.75-1.66 0-3.32.91-4.19 2.34-1.25 2.08-.88 5.4.79 8.08.58.93 1.33 1.95 2.3 1.95.92 0 1.2-.6 2.44-.6 1.23 0 1.48.6 2.44.6.98 0 1.82-1.15 2.4-2.08a8.35 8.35 0 0 0 1.02-2.35c-1.38-.59-2.33-1.94-2.33-3.54 0-1.41.78-2.56 1.9-3.17a4.85 4.85 0 0 0-2.01-.48z"
                fill="#1C1B1B"
              />
            </svg>
            <span>Apple</span>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-3.5">
          <p className="text-center font-inter text-base leading-6 text-[#5B403C]">
            Don't have an account?{" "}
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
