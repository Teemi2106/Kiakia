import { AlertCircle, ArrowRight, MailCheck } from "lucide-react";
import { cn } from "@kiakia/ui";

/**
 * Error and success states for the auth forms.
 *
 * Previously both were a bare `<p className="text-sm text-danger">` sitting
 * flush against the submit button — easy to miss, and on the register form
 * the success case replaced the whole form with one unstyled sentence. These
 * are the same two states given enough weight to be noticed, plus the
 * role="alert"/"status" wiring that makes them reach a screen reader.
 */

export function AuthError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-surface px-4 py-3"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="font-inter text-[13px] leading-5 text-danger">{message}</p>
    </div>
  );
}

/** Terminal success — "check your email", shown in place of the form. */
export function AuthSuccess({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="rounded-3xl border border-kk-line/60 bg-white p-7 text-center shadow-[0_20px_50px_-30px_rgba(28,27,27,0.4)]"
    >
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-positive-surface">
        <MailCheck className="size-6 text-kk-green" />
      </span>
      <h2 className="mt-5 font-sora text-xl font-bold tracking-[-0.02em] text-kk-ink">
        Check your inbox
      </h2>
      <p className="mt-2 font-inter text-[14px] leading-6 text-kk-cocoa">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * The primary submit. Not @kiakia/ui's <Button>: that one is a 40px
 * `rounded-control` product button, and every auth screen was overriding
 * ~15 of its classes to get back to the 56px accented pill the Figma screens
 * (and the marketing CTAs) actually use. This is that pill, once.
 */
export function AuthSubmit({
  children,
  pending,
  className,
}: {
  children: React.ReactNode;
  pending?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "kk-shine group mt-1 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl",
        "bg-(--auth-accent) font-inter text-[15px] font-semibold text-white",
        "shadow-[0_18px_40px_-16px_rgb(var(--auth-accent-glow)/0.85)]",
        "transition-all duration-300 hover:-translate-y-0.5 hover:bg-(--auth-accent-deep)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--auth-accent)",
        "active:translate-y-0 disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : null}
      {children}
      {pending ? null : (
        <ArrowRight className="size-[18px] shrink-0 transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </button>
  );
}
