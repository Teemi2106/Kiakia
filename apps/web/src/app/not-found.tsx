import { buttonVariants } from "@kiakia/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="text-sm font-medium text-ink-muted">404</p>
      <h1 className="text-2xl font-semibold text-ink">We couldn&apos;t find that page</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        The link might be broken, or the page may have moved.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back to KiaKia
      </Link>
    </div>
  );
}
