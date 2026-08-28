import Link from "next/link";
import { ShoppingBag, Store } from "lucide-react";
import { cn } from "@kiakia/ui";

/**
 * Customer ⇄ vendor toggle, pinned to the top-right of every auth screen.
 *
 * Fixes a real dead end rather than being decoration: /login and
 * /vendor/login previously had no route between them, so a kitchen owner who
 * arrived at the customer form (or vice versa) had to go back out to the
 * marketing page to find the other door.
 *
 * Two <Link>s, not a control — the "state" is which URL you are on, so there
 * is nothing to hydrate and the thumb position is a server-rendered style.
 */
export function RoleSwitch({ active }: { active: "customer" | "vendor" }) {
  return (
    <div
      className="relative grid grid-cols-2 rounded-full border border-kk-line/60 bg-kk-sand/80 p-1 backdrop-blur"
      style={{ "--kk-switch-x": active === "vendor" ? "100%" : "0%" } as React.CSSProperties}
    >
      {/* Sliding thumb. Sits behind the labels, so it never intercepts a tap. */}
      <span
        aria-hidden="true"
        className="kk-switch-thumb pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-[0_2px_10px_-2px_rgba(28,27,27,0.18)]"
      />
      <RoleTab href="/login" icon={ShoppingBag} label="Order" active={active === "customer"} />
      <RoleTab href="/vendor/login" icon={Store} label="Sell" active={active === "vendor"} />
    </div>
  );
}

function RoleTab({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof Store;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 sm:px-3.5",
        "font-inter text-[12px] font-semibold transition-colors duration-200 sm:text-[13px]",
        active ? "text-(--auth-accent)" : "text-kk-cocoa/70 hover:text-kk-ink",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </Link>
  );
}
