// app/(marketing)/_components/Faq.tsx
import Link from "next/link";
import { Reveal } from "./Reveal";

/**
 * Ordered by what someone standing in their kitchen at 8pm actually wants to
 * know. Half of these used to be about the payment flow; that is now one
 * question, because it is one question people ask — not the reason they came.
 */
const QUESTIONS = [
  {
    q: "How fast is fast?",
    a: "Most orders are at the door inside 30 minutes. Your food is never held back to share a bike with three other drops, the ride offer goes out to every rider around the vendor at the same instant, and you are only ever shown kitchens close enough that it arrives hot.",
  },
  {
    q: "What can I actually order?",
    a: "Whatever is being cooked and sold around you — rice and stews, suya, swallow and soups, shawarma, small chops, breakfast, drinks. Plus the shops, for groceries and the thing you forgot to buy on the way home.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. KiaKia runs in your browser on a phone or a laptop. Create an account, order, and watch it come from the same place.",
  },
  {
    q: "How do I know the kitchen is any good?",
    a: "Every vendor is checked before they can take a single order, and what you see is their real menu, their real prices and their live opening hours. Nothing you tap turns out to be closed.",
  },
  {
    q: "Is my money safe?",
    a: "Yes. It leaves your account at checkout and stops with us — not with the vendor, and not ours to spend. It is only paid out once the food is in your hand, so if an order never arrives there is nothing to chase and no refund queue to join.",
  },
  {
    q: "I run a kitchen. When do I get paid?",
    a: "The same moment the customer takes delivery — not on a weekly cycle, and never clawed back by a chargeback weeks later. The money was already committed before you started cooking.",
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
              have the fine print.
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
