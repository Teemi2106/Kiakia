// components/marketing/Hero.tsx
import { buttonVariants, cn } from "@kiakia/ui";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "./StepIcon";

export function Hero() {
  return (
    <>
      {/* Desktop Hero */}
      <section className="relative hidden h-[600px] sm:block">
        <Image
          src="/assets/hero-banner.png"
          alt="A fresh burger and fries"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <h1 className="font-sora text-[48px] font-extrabold leading-[56px] tracking-[-0.96px] text-[#1C1B1B]">
            Fast. Fresh. Reliable.
          </h1>
          <p className="max-w-[540px] font-inter text-[18px] leading-7 text-[#5B403C]">
            The most trusted way to get your favorite local meals delivered.
          </p>
          <Link
            href="/register"
            className={cn(
              buttonVariants({ variant: "primary" }),
              "flex h-[52px] items-center gap-2 rounded-xl bg-[#B61913] px-8 font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-white hover:bg-[#9e1611]",
            )}
          >
            <Icon icon="/assets/hero-icon.png" size={4} />
            Order Now
          </Link>
        </div>
      </section>

      {/* Mobile Hero */}
      <section className="flex flex-col items-center gap-8 px-4 pb-0 pt-6 sm:hidden">
        <div className="relative h-64 w-full overflow-hidden rounded-3xl border border-[#E4BEB8]">
          <Image
            src="/assets/hero-banner.png"
            alt="Gourmet artisan burger with melting cheese and crispy fries"
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(252,249,248,0.4)] to-transparent" />
        </div>
        <div className="flex max-w-[448px] flex-col items-center gap-4">
          <h1 className="w-full text-center font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B] whitespace-nowrap sm:text-4xl sm:leading-[44px] md:text-[48px] md:leading-[56px]">
            Cravings Delivered Fast.
          </h1>
          <p className="px-4 text-center font-inter text-base leading-6 text-[#5B403C]">
            Experience the fastest connection between local kitchens and your
            front door.
          </p>
          <Link
            href="/register"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#B61913] px-8 font-inter text-sm font-semibold leading-5 tracking-[0.14px] text-white shadow-sm hover:bg-[#9e1611]"
          >
            <Icon icon="/assets/hero-icon.png" size={4} />
            Order Now
          </Link>
        </div>
      </section>
    </>
  );
}
