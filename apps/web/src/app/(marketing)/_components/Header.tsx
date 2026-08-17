// components/marketing/Header.tsx
"use client";

import { buttonVariants, cn } from "@kiakia/ui";
import { Menu, User, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <header className="flex h-14 items-center justify-between bg-[#FCF9F8] px-4 sm:h-[72px] sm:px-6">
        {/* Mobile: Menu Icon */}
        <button
          className="sm:hidden"
          aria-label="Menu"
          onClick={() => setIsMobileMenuOpen(true)}
        >
          <Menu className="size-5 text-[#B61913]" />
        </button>

        {/* Logo */}
        <Link href="/" className="shrink-0">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={247}
            className="h-10 w-auto sm:h-10"
            priority
          />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            href="#how-it-works"
            scroll={true}
            className="font-inter text-base text-[#5B403C] hover:text-ink"
          >
            How it Works
          </Link>
          <Link
            href="/vendor/register"
            className="font-inter text-base text-[#5B403C] hover:text-ink"
          >
            Become a Vendor
          </Link>
          <span
            className="cursor-not-allowed font-inter text-base text-[#5B403C] opacity-60"
            title="Coming soon"
          >
            Become a Rider
          </span>
          <Link
            href="#footer"
            scroll={true}
            className="font-inter text-base text-[#5B403C] hover:text-ink"
          >
            Contact
          </Link>
        </nav>

        {/* Desktop Auth Buttons */}
        <div className="hidden items-center gap-4 sm:flex">
          <Link
            href="/login"
            className="font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-[#B61913] hover:text-ink"
          >
            Login
          </Link>
          <Link
            href="/register"
            className={cn(
              buttonVariants({ variant: "primary", size: "sm" }),
              "rounded-xl bg-[#B61913] px-4 py-2 font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-white hover:bg-[#9e1611]",
            )}
          >
            Order Now
          </Link>
        </div>

        {/* Mobile: Profile Icon */}
        <Link className="sm:hidden" aria-label="Profile" href="/login">
          <User className="size-5 text-[#B61913]" />
        </Link>
      </header>

      {/* ===== MOBILE SLIDE-IN MENU ===== */}
      <>
        {/* Overlay */}
        <div
          className={cn(
            "fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 sm:hidden",
            isMobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        {/* Menu Panel */}
        <div
          className={cn(
            "fixed left-0 top-0 z-50 h-full w-[280px] bg-[#FCF9F8] transition-transform duration-300 ease-out sm:hidden",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {/* Menu Header */}
          <div className="flex h-14 items-center justify-between border-b border-[#E4BEB8] px-4">
            <Image
              src="/assets/logo-mark.png"
              alt="KiaKia"
              width={1104}
              height={247}
              className="h-8 w-auto"
            />
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="rounded-full p-2 hover:bg-black/5"
              aria-label="Close menu"
            >
              <X className="size-5 text-[#1C1B1B]" />
            </button>
          </div>

          {/* Menu Navigation */}
          <nav className="flex flex-col p-4">
            <Link
              href="#how-it-works"
              className="py-3 font-inter text-base text-[#5B403C] hover:text-ink"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              How it Works
            </Link>
            <Link
              href="/vendor/register"
              className="py-3 font-inter text-base text-[#5B403C] hover:text-ink"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Become a Vendor
            </Link>
            <span
              className="cursor-not-allowed py-3 font-inter text-base text-[#5B403C] opacity-60"
              title="Coming soon"
            >
              Become a Rider
            </span>
            <Link
              href="#footer"
              className="py-3 font-inter text-base text-[#5B403C] hover:text-ink"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Contact
            </Link>
          </nav>

          {/* Divider */}
          <div className="mx-4 border-t border-[#E4BEB8]" />

          {/* Auth Links */}
          <div className="flex flex-col p-4">
            <Link
              href="/login"
              className="py-3 font-inter text-sm font-semibold text-[#B61913] hover:text-ink"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Login
            </Link>
            <Link
              href="/register"
              className="mt-2 flex items-center justify-center rounded-xl bg-[#B61913] px-4 py-3 font-inter text-sm font-semibold text-white hover:bg-[#9e1611]"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Order Now
            </Link>
          </div>
        </div>
      </>
    </>
  );
}
