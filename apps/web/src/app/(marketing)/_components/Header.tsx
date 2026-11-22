// app/(marketing)/_components/Header.tsx
"use client";

import { cn } from "@kiakia/ui";
import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RestaurantSign } from "./RestaurantSign";

const NAV = [
  { label: "What we deliver", href: "/#cravings" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "For vendors", href: "/partner" },
  { label: "For riders", href: "/ride" },
  { label: "FAQ", href: "/#faq" },
] as const;

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  // Read-progress rail + the transparent→solid swap. Written straight to the
  // node inside rAF rather than through state, so scrolling never re-renders
  // the nav.
  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const scrolled = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current) {
        const ratio = scrollable > 0 ? Math.min(scrolled / scrollable, 1) : 0;
        progressRef.current.style.transform = `scaleX(${ratio})`;
      }
      setIsScrolled(scrolled > 12);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const closeMenu = useCallback(() => setIsMobileMenuOpen(false), []);

  // Lock the page behind the drawer, and let Escape close it.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileMenuOpen, closeMenu]);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          isScrolled
            ? "bg-kk-cream/80 shadow-[0_1px_0_0_rgba(228,190,184,0.7),0_8px_30px_-12px_rgba(28,27,27,0.15)] backdrop-blur-xl"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:h-20 sm:gap-4 sm:px-6 lg:px-8">
          <button
            type="button"
            className="-ml-2 rounded-full p-2 text-kk-red transition-colors hover:bg-kk-red/10 lg:hidden"
            aria-label="Open menu"
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          <Link href="/" className="shrink-0 transition-transform duration-300 hover:scale-[1.03]">
            <Image
              src="/assets/logo-mark.png"
              alt="KiaKia"
              width={1104}
              height={270}
              className="h-8 w-auto max-w-none mix-blend-multiply sm:h-9"
              preload
            />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group relative rounded-full px-3.5 py-2 font-inter text-[15px] font-medium text-kk-cocoa transition-colors hover:text-kk-ink"
              >
                {item.label}
                <span className="absolute inset-x-3.5 bottom-1 h-px origin-left scale-x-0 bg-kk-red transition-transform duration-300 group-hover:scale-x-100" />
              </Link>
            ))}
          </nav>

          <RestaurantSign />
        </div>

        {/* Read-progress rail, hairline along the header's bottom edge. */}
        <div
          ref={progressRef}
          aria-hidden="true"
          className="h-0.5 origin-left scale-x-0 bg-gradient-to-r from-kk-orange via-kk-red to-kk-red-deep"
        />
      </header>

      {/* ---------------------------------------------------- mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-kk-ink-deep/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          isMobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={closeMenu}
        aria-hidden="true"
      />

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[340px] flex-col bg-kk-cream transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        // Keeps the panel out of the tab order while it is off-canvas.
        inert={!isMobileMenuOpen}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={270}
            className="h-7 w-auto max-w-none mix-blend-multiply"
          />
          <button
            type="button"
            onClick={closeMenu}
            className="rounded-full p-2 text-kk-ink transition-colors hover:bg-kk-red/10"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-5 pt-6">
          {NAV.map((item, i) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={closeMenu}
              style={{ transitionDelay: isMobileMenuOpen ? `${80 + i * 45}ms` : "0ms" }}
              className={cn(
                "border-b border-kk-line/60 py-4 font-sora text-2xl font-semibold text-kk-ink transition-all duration-500",
                isMobileMenuOpen ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-kk-line/60 px-5 py-5 text-center">
          <p className="font-inter text-sm font-semibold text-kk-cocoa">
            KiaKia is coming soon.
          </p>
        </div>
      </div>
    </>
  );
}
