import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Coming soon",
  description: "KiaKia is getting ready. Good food is coming soon.",
  alternates: { canonical: "/" },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "KiaKia",
    locale: "en_NG",
    title: "KiaKia is coming soon",
    description: "KiaKia is getting ready. Good food is coming soon.",
  },
  twitter: {
    card: "summary",
    title: "KiaKia is coming soon",
    description: "KiaKia is getting ready. Good food is coming soon.",
  },
};

export default function ComingSoonPage() {
  return (
    <main className="relative isolate flex min-h-screen overflow-hidden bg-kk-cream text-kk-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-36 -top-40 -z-10 size-[34rem] rounded-full bg-kk-orange/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-52 -left-36 -z-10 size-[32rem] rounded-full bg-kk-orange/15 blur-3xl"
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-7 sm:px-10 sm:py-9 lg:px-16">
        <header className="flex items-center justify-center sm:justify-start">
          <div className="flex items-center gap-2.5" aria-label="KiaKia">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-kk-orange font-sora text-xl font-extrabold text-white shadow-[0_8px_24px_rgba(254,142,39,0.25)]">
              K
            </span>
            <span className="font-sora text-2xl font-extrabold tracking-[-0.06em] text-kk-ink">
              KiaKia
            </span>
          </div>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-20 text-center sm:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-kk-line bg-white/80 px-4 py-2 text-sm font-semibold text-kk-cocoa shadow-sm">
            <span className="size-2 rounded-full bg-kk-orange" aria-hidden="true" />
            We’re getting things ready
          </div>

          <h1 className="mt-8 max-w-4xl font-sora text-5xl font-extrabold leading-[1.05] tracking-[-0.065em] sm:text-7xl lg:text-8xl">
            KiaKia is
            <span className="mt-2 block text-kk-orange">coming soon.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-kk-cocoa sm:mt-8 sm:text-lg sm:leading-8">
            Your neighbourhood’s favourite meals are getting ready to come to
            your door. We can’t wait to welcome you.
          </p>

          <div className="mt-12 flex items-center gap-2" aria-hidden="true">
            <span className="h-1.5 w-8 rounded-full bg-kk-orange" />
            <span className="size-1.5 rounded-full bg-kk-line" />
            <span className="size-1.5 rounded-full bg-kk-line" />
          </div>
        </section>

        <footer className="pb-2 text-center text-xs font-medium tracking-wide text-kk-cocoa/70 sm:text-left">
          © KiaKia
        </footer>
      </div>
    </main>
  );
}
