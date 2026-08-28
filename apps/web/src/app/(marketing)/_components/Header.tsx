// app/(marketing)/_components/Header.tsx
"use client";

import { cn } from "@kiakia/ui";
import { ArrowRight, ChevronDown, LogOut, Menu, User, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";

interface Account {
  fullName: string;
  avatarUrl: string | null;
  accountHref: string;
}

const NAV = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Escrow", href: "/#escrow" },
  { label: "For vendors", href: "/vendor/register" },
  { label: "FAQ", href: "/#faq" },
] as const;

export function Header({ account }: { account: Account | null }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isAccountMenuOpen]);

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
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-6 lg:px-8">
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
              height={247}
              className="h-8 w-auto mix-blend-multiply sm:h-9"
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

          <div className="hidden items-center gap-3 lg:flex">
            {account ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen((open) => !open)}
                  aria-expanded={isAccountMenuOpen}
                  className="flex items-center gap-2 rounded-full border border-kk-line bg-white/80 py-1.5 pl-1.5 pr-3 transition-colors hover:border-kk-red/40 hover:bg-white"
                >
                  <AccountAvatar account={account} />
                  <span className="max-w-[9rem] truncate font-inter text-sm font-medium text-kk-ink">
                    {account.fullName}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 text-kk-cocoa transition-transform duration-200",
                      isAccountMenuOpen && "rotate-180",
                    )}
                  />
                </button>

                {isAccountMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-kk-line bg-white py-1.5 shadow-[0_20px_45px_-20px_rgba(28,27,27,0.35)]">
                    <Link
                      href={account.accountHref}
                      className="block px-4 py-2.5 font-inter text-sm text-kk-ink transition-colors hover:bg-kk-cream"
                      onClick={() => setIsAccountMenuOpen(false)}
                    >
                      My account
                    </Link>
                    <form action={signOutAction}>
                      <button
                        type="submit"
                        className="flex w-full items-center gap-2 px-4 py-2.5 font-inter text-sm text-kk-red transition-colors hover:bg-kk-red-soft"
                      >
                        <LogOut className="size-4" />
                        Log out
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-full px-4 py-2 font-inter text-[15px] font-semibold text-kk-ink transition-colors hover:text-kk-red"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="kk-shine group inline-flex items-center gap-2 rounded-full bg-kk-red px-5 py-2.5 font-inter text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(182,25,19,0.9)] transition-colors hover:bg-kk-red-deep"
                >
                  Order now
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>

          <Link
            className="-mr-2 rounded-full p-2 text-kk-red transition-colors hover:bg-kk-red/10 lg:hidden"
            aria-label={account ? "Your account" : "Log in"}
            href={account ? account.accountHref : "/login"}
          >
            {account ? <AccountAvatar account={account} /> : <User className="size-5" />}
          </Link>
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
            height={247}
            className="h-7 w-auto mix-blend-multiply"
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
          <span className="cursor-not-allowed py-4 font-sora text-2xl font-semibold text-kk-cocoa/45">
            For riders
            <span className="ml-2 align-middle font-inter text-[11px] font-semibold uppercase tracking-widest text-kk-orange-deep">
              soon
            </span>
          </span>
        </nav>

        <div className="flex flex-col gap-3 border-t border-kk-line/60 p-5">
          {account ? (
            <>
              <Link
                href={account.accountHref}
                className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 font-inter text-sm font-semibold text-kk-ink"
                onClick={closeMenu}
              >
                <AccountAvatar account={account} />
                <span className="truncate">{account.fullName}</span>
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-kk-line px-4 py-3 font-inter text-sm font-semibold text-kk-red"
                >
                  <LogOut className="size-4" />
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/register"
                onClick={closeMenu}
                className="flex items-center justify-center gap-2 rounded-2xl bg-kk-red px-4 py-3.5 font-inter text-sm font-semibold text-white"
              >
                Order now
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                onClick={closeMenu}
                className="flex items-center justify-center rounded-2xl border border-kk-line px-4 py-3.5 font-inter text-sm font-semibold text-kk-ink"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function AccountAvatar({ account }: { account: Account }) {
  if (account.avatarUrl) {
    return (
      <Image
        src={account.avatarUrl}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-kk-red/10 font-inter text-xs font-semibold text-kk-red">
      {account.fullName.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
