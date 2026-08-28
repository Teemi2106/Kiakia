// app/(marketing)/_components/Faq.tsx
import Link from "next/link";
import { Reveal } from "./Reveal";

const QUESTIONS = [
  {
    q: "What actually happens to my money?",
    a: "It leaves your account at checkout and stops at KiaKia. It is not credited to the vendor and it is not ours to spend — it is held against your specific order until that order is confirmed delivered.",
  },
  {
    q: "What if the rider never turns up?",
    a: "Then the release never happens and the funds stay where they are. There is no vendor to chase and no refund queue to join, because the payout was never made in the first place.",
  },
  {
    q: "Why a 4-digit code and not a photo or a signature?",
    a: "Because a code is the one piece of proof only you can give. It is shown to you, not to the vendor, and reading it out at your door is what tells the system the hand-off genuinely happened.",
  },
  {
    q: "How is it actually faster?",
    a: "Because nothing waits. Your order is never batched with other drops, the offer goes out to every rider around the vendor at the same instant, and the kitchens you can order from are the ones already close to you.",
  },
  {
    q: "I run a kitchen. When do I get paid?",
    a: "The same moment the customer's code is accepted at the door — not on a weekly cycle, and never subject to a chargeback weeks later. The money was already committed before you started cooking.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. KiaKia runs in your browser on a phone or a laptop. Create an account, order, and track it from the same place.",
  },
] as const;

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 bg-kk-sand px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal>
          <div className="lg:sticky lg:top-28">
            <p className="flex items-center gap-3 font-inter text-[11px] font-semibold uppercase tracking-[0.28em] text-kk-red">
              <span className="h-px w-8 bg-kk-red/50" />
              Questions
            </p>
            <h2 className="mt-5 font-sora text-[clamp(2rem,4.4vw,3rem)] font-extrabold leading-[1.03] tracking-[-0.03em] text-kk-ink">
              The ones people ask first.
            </h2>
            <p className="mt-5 max-w-sm font-inter text-[15px] leading-7 text-kk-cocoa">
              Still stuck on something? The{" "}
              <Link href="/support" className="font-semibold text-kk-red underline underline-offset-4">
                support page
              </Link>{" "}
              covers the rest, and the{" "}
              <Link href="/terms" className="font-semibold text-kk-red underline underline-offset-4">
                terms
              </Link>{" "}
              spell out the escrow mechanics in full.
            </p>
          </div>
        </Reveal>

        <div className="space-y-3">
          {QUESTIONS.map((item, i) => (
            <Reveal key={item.q} delay={i * 70}>
              <details className="kk-faq group rounded-2xl border border-kk-line/80 bg-white/70 px-5 transition-colors duration-300 open:bg-white hover:border-kk-red/35 sm:px-7">
                <summary className="flex cursor-pointer items-center justify-between gap-6 py-5 font-sora text-lg font-bold text-kk-ink sm:py-6 sm:text-xl">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="kk-faq-chevron relative flex size-8 shrink-0 items-center justify-center rounded-full bg-kk-red/10 text-kk-red transition-transform duration-300"
                  >
                    <span className="absolute h-0.5 w-3.5 rounded-full bg-current" />
                    <span className="absolute h-3.5 w-0.5 rounded-full bg-current" />
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 font-inter text-[15px] leading-7 text-kk-cocoa">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
