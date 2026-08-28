import Image from "next/image";
import Link from "next/link";
import {
  Bike,
  Lock,
  Rocket,
  ShieldCheck,
  Star,
  Store,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * The left half of every auth screen.
 *
 * Replaces <ImagePane> (a photo with a caption gradient). The brief the
 * marketing page sets — dark charcoal stage, ambient colour wash, a live
 * artefact of the product rather than a stock kitchen — applies just as much
 * at the moment someone decides whether to hand over an email address, so
 * this borrows that vocabulary directly.
 *
 * Server component on purpose: every moving part is a CSS keyframe from
 * auth.css, so the stage costs no client JS and paints on the first frame.
 */

interface AuthStageProps {
  /** Photograph behind the wash. */
  imageSrc: string;
  altText: string;
  eyebrow: string;
  heading: React.ReactNode;
  subheading: string;
  /** The floating artefact — one of the *Card exports below. */
  panel: React.ReactNode;
  /** Trust line along the bottom. */
  footnote: string;
}

export function AuthStage({
  imageSrc,
  altText,
  eyebrow,
  heading,
  subheading,
  panel,
  footnote,
}: AuthStageProps) {
  return (
    <aside className="relative hidden overflow-hidden bg-kk-ink-deep lg:flex lg:w-[47%] lg:shrink-0 lg:flex-col xl:w-[52%]">
      {/* Photography, pushed far back — it sets a mood, it isn't the subject. */}
      <Image
        src={imageSrc}
        alt={altText}
        fill
        sizes="52vw"
        quality={85}
        priority
        className="object-cover opacity-25"
      />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-kk-ink-deep/95 via-kk-ink-deep/80 to-kk-ink-deep/95" />
        <div className="kk-grid absolute inset-0 text-white/[0.045]" />
        <div className="kk-blob -left-32 -top-24 size-[520px] bg-(--auth-accent) opacity-40" />
        <div className="kk-blob -right-24 bottom-[-10%] size-[460px] bg-kk-orange/25" />
        <div className="kk-blob left-1/4 top-1/2 size-[340px] bg-kk-mint/10" />
      </div>

      <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
        {/* ------------------------------------------------------ wordmark */}
        <Link
          href="/"
          className="kk-enter inline-flex w-fit items-center gap-2.5"
          style={{ "--kk-delay": "60ms" } as React.CSSProperties}
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-(--auth-accent) shadow-[0_10px_30px_-8px_rgb(var(--auth-accent-glow)/0.9)]">
            <Bike className="size-5 text-white" />
          </span>
          <span className="font-sora text-2xl font-extrabold tracking-[-0.03em] text-white">
            KiaKia
          </span>
        </Link>

        {/* --------------------------------------------------------- pitch */}
        <div className="max-w-lg py-10">
          <p
            className="kk-enter flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-white/55"
            style={{ "--kk-delay": "140ms" } as React.CSSProperties}
          >
            <span className="h-px w-8 bg-white/30" />
            {eyebrow}
          </p>

          <h2
            className="kk-enter mt-6 font-sora text-[clamp(2.25rem,3.4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-white"
            style={{ "--kk-delay": "220ms" } as React.CSSProperties}
          >
            {heading}
          </h2>

          <p
            className="kk-enter mt-5 max-w-md font-inter text-[17px] leading-8 text-white/60"
            style={{ "--kk-delay": "300ms" } as React.CSSProperties}
          >
            {subheading}
          </p>

          <div className="kk-enter mt-10" style={{ "--kk-delay": "380ms" } as React.CSSProperties}>
            {panel}
          </div>
        </div>

        {/* ------------------------------------------------------ footnote */}
        <p
          className="kk-enter flex items-center gap-2 font-inter text-[13px] text-white/40"
          style={{ "--kk-delay": "460ms" } as React.CSSProperties}
        >
          <ShieldCheck className="size-4 shrink-0 text-kk-mint/70" />
          {footnote}
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ cards */

const GLASS =
  "kk-float max-w-sm rounded-3xl border border-white/10 bg-white/[0.055] p-5 backdrop-blur-xl " +
  "shadow-[0_28px_60px_-24px_rgba(0,0,0,0.85)]";

/** Sign-in: the thing you came back for — an order already in motion. */
export function LiveOrderCard() {
  return (
    <div className={GLASS}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-inter text-[11px] font-semibold uppercase tracking-[0.18em] text-kk-mint">
          <span className="kk-ping relative inline-flex size-1.5 rounded-full bg-kk-mint" />
          Live
        </span>
        <span className="font-inter text-[11px] text-white/45">Order #KK-4821</span>
      </div>

      <p className="mt-4 font-sora text-lg font-bold leading-tight text-white">
        Rider is 6 minutes away
      </p>
      <p className="mt-1 font-inter text-[13px] text-white/50">
        Jollof rice + suya platter · Mama Nkechi&apos;s Kitchen
      </p>

      {/* Progress rail — the fill is a CSS keyframe, not state. */}
      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="kk-progress relative h-full w-full rounded-full" />
      </div>

      <div className="mt-3 flex items-center justify-between font-inter text-[11px] text-white/45">
        <span>Picked up</span>
        <span className="text-white/70">On the way</span>
        <span>Your door</span>
      </div>

      <div className="mt-5 flex items-center gap-2.5 rounded-2xl bg-white/[0.06] px-3.5 py-3">
        <Lock className="size-4 shrink-0 text-kk-mint" />
        <p className="font-inter text-[12px] leading-5 text-white/65">
          ₦8,450 held in escrow — released by your code at the door.
        </p>
      </div>
    </div>
  );
}

const CODE = ["4", "9", "2", "7"] as const;

/** Sign-up: the promise that makes handing over an email worth it. */
export function EscrowCodeCard() {
  return (
    <div className={GLASS}>
      <p className="font-inter text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
        Delivery code
      </p>

      <div className="mt-4 flex gap-2.5">
        {CODE.map((digit, i) => (
          <span
            key={`${digit}-${i}`}
            className="kk-digit flex h-14 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] font-sora text-2xl font-extrabold text-white"
            style={{ "--kk-delay": `${i * 160}ms` } as React.CSSProperties}
          >
            {digit}
          </span>
        ))}
      </div>

      <p className="mt-5 font-sora text-lg font-bold leading-tight text-white">
        Nobody gets paid until you say so.
      </p>
      <p className="mt-1.5 font-inter text-[13px] leading-6 text-white/50">
        Your money sits in escrow from checkout to hand-off. Four digits at your door are the only
        key that opens it.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Stat icon={Bike} label="Avg. delivery" value="26 min" />
        <Stat icon={Star} label="Vendor rating" value="4.8 / 5" />
      </div>
    </div>
  );
}

/** Vendor: the numbers a kitchen owner actually signs in for. */
export function VendorPayoutCard() {
  return (
    <div className={GLASS}>
      <div className="flex items-center justify-between">
        <span className="font-inter text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Today
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-kk-mint/15 px-2.5 py-1 font-inter text-[11px] font-semibold text-kk-mint">
          <TrendingUp className="size-3" />
          +18%
        </span>
      </div>

      <p className="mt-4 font-sora text-[2.5rem] font-extrabold leading-none tracking-[-0.03em] text-white">
        ₦184,200
      </p>
      <p className="mt-2 font-inter text-[13px] text-white/50">
        Released to your wallet across 37 delivered orders.
      </p>

      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="kk-progress relative h-full w-full rounded-full" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Stat icon={Wallet} label="Settling now" value="₦22,900" />
        <Stat icon={Bike} label="Riders live" value="6 nearby" />
      </div>
    </div>
  );
}

/** Vendor sign-up: what the old <ValueProps> said, on the stage where it
 *  belongs instead of squeezed beside a five-field form. */
const VENDOR_PITCH = [
  {
    icon: Rocket,
    title: "Live in minutes",
    body: "Add your menu, set your hours, start taking orders the same day.",
  },
  {
    icon: Lock,
    title: "Escrow-backed payments",
    body: "Every naira is secured at checkout, before a rider is dispatched.",
  },
  {
    icon: Wallet,
    title: "Same-day settlement",
    body: "Delivery confirmed, funds released — no weekly payout wait.",
  },
] as const;

export function VendorPitchCard() {
  return (
    <div className={GLASS}>
      <ul className="space-y-4">
        {VENDOR_PITCH.map((item) => (
          <li key={item.title} className="flex gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] ring-1 ring-inset ring-white/10">
              <item.icon className="size-[18px] text-kk-orange" />
            </span>
            <div>
              <p className="font-sora text-sm font-bold text-white">{item.title}</p>
              <p className="mt-0.5 font-inter text-[12.5px] leading-5 text-white/50">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 font-inter text-[12px] text-white/45">
        <Store className="size-3.5 shrink-0 text-white/35" />
        No setup fee. No monthly subscription. You keep the kitchen.
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3.5 py-3">
      <Icon className="size-4 text-white/40" />
      <p className="mt-2 font-sora text-sm font-bold text-white">{value}</p>
      <p className="font-inter text-[11px] text-white/40">{label}</p>
    </div>
  );
}
