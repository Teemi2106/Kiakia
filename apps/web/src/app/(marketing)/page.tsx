import { buttonVariants, cn } from "@kiakia/ui";
import { Lock, MapPin, Share2, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

// Deliberately static and Supabase-free: the marketing route must build
// and render with zero live backend, so `next build` proves this route
// group stays decoupled from (customer)/(vendor). See the Phase 0 plan's
// verification step.
export const metadata: Metadata = {
  title: "Fast. Fresh. Reliable.",
};

const STEPS = [
  {
    title: "Discover local flavors",
    description:
      "Browse hundreds of local restaurants and hidden gems right in your neighborhood.",
    icon: MapPin,
    accent: "bg-danger-surface text-danger",
  },
  {
    title: "Pay securely via escrow",
    description:
      "Your money is held safely in escrow until you confirm your food arrived as ordered.",
    icon: Lock,
    accent: "bg-warning-surface text-warning",
  },
  {
    title: "Share code to release",
    description:
      "Give the vendor your unique 4-digit code to instantly release payment upon delivery.",
    icon: Share2,
    accent: "bg-positive-surface text-positive",
  },
] as const;

// Pages some of these would link to (Privacy Policy, Terms, Help Center)
// don't exist yet — rendered as inert labels rather than dead links/`href="#"`,
// same "don't fake it" convention as the disabled OAuth buttons in (auth).
const FOOTER_COLUMNS = [
  [
    { label: "Privacy Policy", href: null },
    { label: "Terms of Service", href: null },
  ],
  [
    { label: "Become a Vendor", href: "/vendor/register" },
    { label: "Help Center", href: null },
  ],
  [{ label: "Safety & Escrow", href: "#how-it-works" }],
] as const;

export default function MarketingHome() {
  return (
    <main className="flex flex-1 flex-col bg-white">
      <header className="flex items-center justify-between px-5 py-4 sm:px-10">
        <Link href="/" className="shrink-0">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={247}
            className="h-7 w-auto sm:h-8"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-ink-muted sm:flex">
          <a href="#how-it-works" className="hover:text-ink">
            How it Works
          </a>
          <Link href="/vendor/register" className="hover:text-ink">
            Become a Vendor
          </Link>
          <span className="cursor-not-allowed opacity-60" title="Coming soon">
            Become a Rider
          </span>
          <a href="#footer" className="hover:text-ink">
            Contact
          </a>
        </nav>

        <div className="hidden items-center gap-4 sm:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-[#B61913] hover:text-ink"
          >
            Login
          </Link>
          <Link
            href="/register"
            className={cn(
              buttonVariants({ variant: "primary", size: "sm" }),
              "gap-1.5 rounded-lg px-4 py-2 text-sm font-medium",
            )}
          >
            Order Now
          </Link>
        </div>
      </header>

      {/* Desktop hero */}
      <section className="hidden  sm:block">
        <div className="relative mx-auto aspect-2/1 max-w-7xl overflow-hidden">
          <Image
            src="/assets/hero-banner.png"
            alt="A fresh burger and fries"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-linear-to-b from-white/70 via-white/25 to-transparent" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
            <h1 className="text-5xl font-bold tracking-tight text-ink">
              Fast. Fresh. Reliable.
            </h1>
            <p className="max-w-xl text-base text-ink-muted">
              The most trusted way to get your favorite local meals delivered.
            </p>
            <Link
              href="/register"
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "gap-2 rounded-lg",
                "flex items-center px-6 py-3 text-lg font-medium",
              )}
            >
              <ShoppingBag className="size-5" /> Order Now
            </Link>
          </div>
        </div>
      </section>

      {/* Mobile hero */}
      <section className="px-5 pt-2 pb-10 sm:hidden">
        <div className="relative aspect-4/3 overflow-hidden rounded-[1.75rem]">
          <Image
            src="/assets/hero-banner.png"
            alt="A fresh burger and fries"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold text-ink">
            Cravings Delivered Fast.
          </h1>
          <p className="mt-1 text-lg text-ink-muted">
            Experience the fastest connection between local kitchens and your
            front door.
          </p>
        </div>
        <Link
          href="/register"
          className={cn(
            buttonVariants({ variant: "primary", size: "lg" }),
            "mt-5 w-full gap-2 rounded-lg",
            "flex items-center justify-center px-6 py-3 text-lg font-medium",
          )}
        >
          <ShoppingBag className="size-5" /> Order Now
        </Link>
      </section>

      <section id="how-it-works" className="px-5 py-16 sm:px-10">
        <h2 className="text-center text-2xl font-semibold text-ink sm:text-3xl">
          How KiaKia Works
        </h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-ink-muted">
          Simple, secure, and fast. The modern way to order food.
        </p>
        <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className={cn(
                "text-center",
                i === 2 && "col-span-2 sm:col-span-1",
              )}
            >
              <div
                className={cn(
                  "mx-auto flex size-12 items-center justify-center rounded-full",
                  step.accent,
                )}
              >
                <step.icon className="size-6" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink">
                {i + 1}. {step.title}
              </h3>
              <p className="mt-2 text-sm text-ink-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface-raised px-5 py-16 sm:px-10">
        <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
          <div className="flex flex-col items-center gap-4 text-center lg:items-start lg:text-left">
            <span className="rounded-pill bg-positive-surface px-3 py-1 text-xs font-medium text-positive">
              Buyer &amp; Seller Protocol
            </span>
            <h2 className="text-2xl font-semibold text-ink sm:text-3xl">
              Zero-Trust Delivery Protocol
            </h2>
            <p className="max-w-md text-sm text-ink-muted">
              Our unique 4-digit code system guarantees that customers only pay
              when their food actually arrives — and vendors are guaranteed
              payment once it does.
            </p>
          </div>
          <div className="relative aspect-16/10 overflow-hidden rounded-[1.75rem]">
            <Image
              src="/assets/zero-trust.png"
              alt="A secure package with a digital lock"
              fill
              sizes="(min-width: 1024px) 480px, 100vw"
              className="object-cover"
            />
          </div>
        </div>

        <div className="mx-auto mt-10 flex max-w-5xl flex-col items-center gap-3 lg:items-start">
          <p className="text-sm font-medium text-ink-muted">
            How it looks on delivery
          </p>
          <div className="flex gap-2">
            {["4", "0", "9", "1"].map((digit, i) => (
              <span
                key={i}
                className="flex size-12 items-center justify-center rounded-control border border-border bg-surface text-xl font-semibold text-ink"
              >
                {digit}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer id="footer" className="px-5 py-12 sm:px-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-between">
          <Image
            src="/assets/logo-full.png"
            alt="KiaKia — Fast. Fresh. Reliable."
            width={1104}
            height={354}
            className="h-14 w-auto"
          />

          <div className="grid grid-cols-2 gap-x-10 gap-y-4 text-center text-sm text-ink-muted sm:flex sm:gap-12 sm:text-left">
            {FOOTER_COLUMNS.map((column, i) => (
              <div key={i} className="flex flex-col gap-2">
                {column.map((link) =>
                  link.href ? (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <span key={link.label}>{link.label}</span>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-muted">
          © {new Date().getFullYear()} KiaKia Food Delivery. Fast. Fresh.
          Reliable.
        </p>
      </footer>
    </main>
  );
}
