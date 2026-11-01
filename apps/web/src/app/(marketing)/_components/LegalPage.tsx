// Shared shell for /terms and /privacy: header, title, "last updated" line,
// numbered sections, footer. Content lives in each page as data so the two
// documents stay structurally identical.
import type { ReactNode } from "react";
import { getMarketingAccount } from "@/lib/auth/marketing-account";
import { Header } from "./Header";
import { Footer } from "./Footer";

/**
 * Who the documents speak for and how to reach them. FILL THESE IN with the
 * details on your CAC certificate before submitting the site for payment
 * provider review - the pages read as unfinished otherwise.
 */
export const LEGAL = {
  /** Registered business name, exactly as on the CAC certificate. */
  entity: "KiaKia",
  /** Registered office address. */
  address: "[Registered office address]",
  /** Monitored inbox for support, privacy requests and legal notices. */
  email: "[support email address]",
  lastUpdated: "November 1, 2026",
} as const;

export interface LegalSection {
  title: string;
  body: ReactNode;
}

export async function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  const account = await getMarketingAccount();

  return (
    <main className="flex min-h-screen flex-col bg-kk-cream">
      <Header account={account} />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="font-sora text-3xl font-bold text-[#1C1B1B]">{title}</h1>
        <p className="mt-2 text-sm text-[#5B403C]/80">Last updated: {LEGAL.lastUpdated}</p>
        <div className="mt-6 space-y-3 leading-7 text-[#5B403C]">{intro}</div>

        <nav aria-label="Contents" className="mt-8 rounded-xl border border-[#E4BEB8]/60 bg-[#FCF9F8] p-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#5B403C]">
            {sections.map((section, index) => (
              <li key={section.title}>
                <a href={`#s${index + 1}`} className="underline-offset-2 hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {sections.map((section, index) => (
            <section key={section.title} id={`s${index + 1}`} className="scroll-mt-24">
              <h2 className="font-sora text-xl font-bold text-[#1C1B1B]">
                {index + 1}. {section.title}
              </h2>
              <div className="mt-3 space-y-3 leading-7 text-[#5B403C] [&_a]:underline [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-6">
                {section.body}
              </div>
            </section>
          ))}
        </div>
      </article>
      <Footer />
    </main>
  );
}
