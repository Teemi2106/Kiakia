// components/marketing/Footer.tsx
import Image from "next/image";
import Link from "next/link";

const FOOTER_LINKS = [
  "Privacy Policy",
  "Terms of Service",
  "Become a Vendor",
  "Help Center",
  "Safety & Escrow",
] as const;

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer id="footer" className="bg-white px-4 py-12 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-7xl">
        {/* Desktop Footer */}
        <div className="hidden flex-row items-start justify-between sm:flex">
          {/* Left: Logo + Copyright on same row */}
          <div className="flex items-center gap-6">
            <Image
              src="/assets/logo-full.png"
              alt="KiaKia — Fast. Fresh. Reliable."
              width={140}
              height={58}
              className="h-8 w-25"
            />
          </div>

          {/* Right: Links spread out */}
          <div className="flex gap-16">
            <div className="flex flex-col gap-4">
              <p className="font-inter text-base leading-6 text-[#5B403C]">
                © {currentYear} KiaKia Food Delivery. Fast. Fresh. Reliable.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <Link
                href="#"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                Privacy Policy
              </Link>
              <Link
                href="#"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                Terms of Service
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              <Link
                href="/vendor/register"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                Become a Vendor
              </Link>
              <Link
                href="#"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                Help Center
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              <Link
                href="#"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                Safety &amp; Escrow
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile Footer */}
        <div className="flex flex-col gap-8 sm:hidden">
          {/* Logo at top */}
          <Image
            src="/assets/logo-full.png"
            alt="KiaKia — Fast. Fresh. Reliable."
            width={140}
            height={58}
            className="h-12 w-auto"
          />

          <div className="flex flex-col gap-4">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link}
                href="#"
                className="font-inter text-base text-[#5B403C] hover:text-ink"
              >
                {link}
              </Link>
            ))}
          </div>
          <p className="font-inter text-base leading-6 text-[#5B403C]">
            © {currentYear} KiaKia Food Delivery. Fast. Fresh. Reliable.
          </p>
        </div>
      </div>
    </footer>
  );
}
