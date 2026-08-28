import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthStage } from "./AuthStage";
import { RoleSwitch } from "./RoleSwitch";

/**
 * The one layout every auth screen renders into.
 *
 * Before this there were eight components covering four screens — a
 * hand-written Mobile* and Desktop* pair per screen, each carrying its own
 * copy of the header, the footer links and a ~40-selector `[&_input]:…`
 * override wall, and each drifting from the others. This is one responsive
 * tree instead: the stage is simply `hidden lg:flex`, so the mobile and
 * desktop treatments can never disagree about copy again.
 *
 * `variant` sets data-auth on the root, which is what swaps --auth-accent
 * (see auth.css) from KiaKia red to vendor amber for everything below.
 */

interface AuthShellProps {
  variant?: "customer" | "vendor";
  /** Where the top-left arrow goes. */
  backHref: string;
  backLabel: string;
  /** Which half of the customer/vendor switch is lit, or none. */
  role?: "customer" | "vendor";
  stage: React.ComponentProps<typeof AuthStage>;
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  /** Sign-in ⇄ sign-up cross-link, rendered under the card. */
  footer?: React.ReactNode;
  /** Terms/privacy line, rendered last. */
  legal?: React.ReactNode;
}

export function AuthShell({
  variant = "customer",
  backHref,
  backLabel,
  role,
  stage,
  title,
  subtitle,
  children,
  footer,
  legal,
}: AuthShellProps) {
  return (
    <div data-auth={variant} className="flex min-h-screen bg-kk-cream">
      <AuthStage {...stage} />

      {/* ------------------------------------------------------ form column */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* A whisper of the stage's wash, so the two halves feel like one
            screen rather than a photo bolted to a form. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="kk-blob -right-40 -top-40 size-[420px] bg-(--auth-accent) opacity-[0.07]" />
          <div className="kk-blob -left-32 bottom-[-15%] size-[380px] bg-kk-orange opacity-[0.07]" />
          <div className="kk-dots absolute inset-0 text-kk-cocoa/[0.07] lg:hidden" />
        </div>

        <header className="relative flex h-16 shrink-0 items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href={backHref}
            aria-label={backLabel}
            className="flex size-10 items-center justify-center rounded-full text-kk-ink transition-colors hover:bg-kk-sand"
          >
            <ArrowLeft className="size-[18px]" />
          </Link>

          {/* The wordmark is the stage's job on large screens. */}
          <Link href="/" className="lg:hidden" aria-label="KiaKia home">
            <Image
              src="/assets/logo-mark.png"
              alt="KiaKia"
              width={120}
              height={40}
              priority
              className="h-8 w-auto object-contain"
            />
          </Link>

          {role ? <RoleSwitch active={role} /> : <span className="size-10 lg:hidden" />}
        </header>

        <div className="relative flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-6 lg:px-8">
          <div className="w-full max-w-[440px]">
            <div
              className="kk-enter"
              style={{ "--kk-delay": "80ms" } as React.CSSProperties}
            >
              <h1 className="font-sora text-[clamp(1.75rem,4.5vw,2.25rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-kk-ink">
                {title}
              </h1>
              <p className="mt-2.5 font-inter text-[15px] leading-7 text-kk-cocoa">{subtitle}</p>
            </div>

            <div
              className="kk-enter mt-8"
              style={{ "--kk-delay": "160ms" } as React.CSSProperties}
            >
              {children}
            </div>

            {footer ? (
              <div
                className="kk-enter mt-7"
                style={{ "--kk-delay": "240ms" } as React.CSSProperties}
              >
                {footer}
              </div>
            ) : null}

            {legal ? (
              <div
                className="kk-enter mt-6"
                style={{ "--kk-delay": "300ms" } as React.CSSProperties}
              >
                {legal}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Sign-in ⇄ sign-up cross-link. Shared so the wording stays identical. */
export function AuthSwap({ prompt, href, cta }: { prompt: string; href: string; cta: string }) {
  return (
    <p className="text-center font-inter text-[15px] text-kk-cocoa">
      {prompt}{" "}
      <Link
        href={href}
        className="font-semibold text-(--auth-accent) underline-offset-4 hover:underline"
      >
        {cta}
      </Link>
    </p>
  );
}

/** Terms/privacy footnote. */
export function AuthLegal({ verb }: { verb: string }) {
  return (
    <p className="text-center font-inter text-xs leading-5 text-kk-cocoa/65">
      By {verb} you agree to our{" "}
      <Link href="/terms" className="underline underline-offset-2 hover:text-kk-ink">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-kk-ink">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
