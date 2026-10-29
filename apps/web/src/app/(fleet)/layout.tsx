import { requireFleetContext } from "@/lib/auth/dal";
import Image from "next/image";
import Link from "next/link";
import { FleetNav } from "./_components/FleetNav";

/**
 * requireFleetContext() is the real gate for the (fleet) group; proxy.ts only
 * proves "logged in". Pages and actions re-check it themselves, because a
 * client-side navigation does not re-run this layout.
 */
export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const { fleet } = await requireFleetContext("/home");

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken md:flex-row">
      <aside className="border-b border-border bg-surface-raised md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <Link href="/fleet" className="flex items-center gap-2 px-4 py-3 md:flex-col md:items-start md:gap-1 md:py-5">
          <Image
            src="/assets/logo-mark.png"
            alt="KiaKia"
            width={1104}
            height={270}
            className="h-7 w-auto max-w-none mix-blend-multiply"
            preload
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Fleet · {fleet.fleetName}</span>
        </Link>
        <FleetNav />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
