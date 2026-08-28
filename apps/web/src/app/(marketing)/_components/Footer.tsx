// app/(marketing)/_components/Footer.tsx
import Image from "next/image";
import Link from "next/link";
import { Lock, Zap } from "lucide-react";

const COLUMNS = [
  {
    heading: "Ordering",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Escrow & your money", href: "/#escrow" },
      { label: "Questions", href: "/#faq" },
      { label: "Create an account", href: "/register" },
      { label: "Log in", href: "/login" },
    ],
  },
  {
    heading: "Partners",
    links: [
      { label: "Become a vendor", href: "/vendor/register" },
      { label: "Vendor login", href: "/vendor/login" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Support", href: "/support" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
    ],
  },
] as const;

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer id="footer" className="relative overflow-hidden bg-kk-ink-deep px-4 pb-10 pt-16 sm:px-6 sm:pb-12 sm:pt-20 lg:px-8">
      <div aria-hidden="true" className="kk-grid pointer-events-none absolute inset-0 text-white/5" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-12 md:grid-cols-[1.3fr_repeat(3,1fr)] md:gap-8">
          <div>
            {/* The logo asset is drawn on a light plate, so it gets a cream
                chip rather than sitting directly on the dark ground. */}
            <Link href="/" className="inline-flex rounded-2xl bg-kk-cream px-4 py-3">
              <Image
                src="/assets/logo-mark.png"
                alt="KiaKia"
                width={1104}
                height={247}
                className="h-7 w-auto"
              />
            </Link>
            <p className="mt-6 max-w-xs font-inter text-[15px] leading-7 text-white/55">
              Food and goods from the shops around you — with your payment held safe until the
              moment it reaches your hand.
            </p>
            <div className="mt-6 flex flex-col gap-2.5 font-inter text-[13px] text-white/45">
              <span className="inline-flex items-center gap-2">
                <Zap className="size-4 text-kk-red" />
                Kia kia — quick quick
              </span>
              <span className="inline-flex items-center gap-2">
                <Lock className="size-4 text-kk-mint" />
                Escrow-protected payments
              </span>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-inter text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
                {column.heading}
              </h2>
              <ul className="mt-5 space-y-3.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center font-inter text-[15px] text-white/70 transition-colors hover:text-white"
                    >
                      <span className="mr-0 h-px w-0 bg-kk-red transition-all duration-300 group-hover:mr-2 group-hover:w-4" />
                      {link.label}
                    </Link>
                  </li>
                ))}
                {column.heading === "Partners" && (
                  <li className="font-inter text-[15px] text-white/25">
                    Rider sign-up
                    <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
                      soon
                    </span>
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-inter text-[13px] text-white/40">
            © {currentYear} KiaKia Food Delivery. Fast. Fresh. Reliable.
          </p>
          <p className="font-inter text-[13px] text-white/40">
            Your money moves when your food does.
          </p>
        </div>
      </div>
    </footer>
  );
}
