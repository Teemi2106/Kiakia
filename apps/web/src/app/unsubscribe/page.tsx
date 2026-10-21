import { unsubscribeAction } from "@/app/actions/unsubscribe";
import { readUnsubscribeToken } from "@/lib/messaging/unsubscribe";
import { Button } from "@kiakia/ui";
import type { Metadata } from "next";
import { firstParam, type SearchParams } from "../(admin)/_components/search-params";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
  // The link carries a signed token; do not pass it on to other sites.
  referrer: "no-referrer",
};

const CHANNEL_WORDS = { email: "emails", sms: "text messages" } as const;

/**
 * Public (no login): the signed token in the link is the credential. GET only
 * shows a confirm button, because mail scanners and link previewers fetch URLs
 * and must not be able to unsubscribe anyone. The button is a Server Action (a
 * POST).
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  // The sending worker's email links use ?token=; ?t= is accepted too.
  const token = firstParam(raw.token) ?? firstParam(raw.t);
  const result = firstParam(raw.result);
  const claim = readUnsubscribeToken(token);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm">
        <h1 className="font-sora text-xl font-semibold text-[#1C1B1B]">Unsubscribe from promotions</h1>

        {!claim || !token ? (
          <p className="mt-3 font-inter text-sm text-[#5B403C]">
            This link is not valid, or it has expired. If you want to stop promotional messages, sign in to KiaKia and turn them off in your settings.
          </p>
        ) : result === "done" ? (
          <p role="status" className="mt-3 rounded-xl bg-[#A3F69D]/40 px-3 py-2 font-inter text-sm text-[#1C1B1B]">
            Done. You will no longer get promotional {CHANNEL_WORDS[claim.channel]} from KiaKia. You will still get important messages about your orders and account.
          </p>
        ) : (
          <>
            <p className="mt-3 font-inter text-sm text-[#5B403C]">
              Stop promotional {CHANNEL_WORDS[claim.channel]} from KiaKia? You will still get important messages about your orders and account.
            </p>
            {(result === "failed" || result === "invalid") && (
              <p role="alert" className="mt-3 rounded-xl bg-[#FFDAD6] px-3 py-2 font-inter text-sm text-[#BA1A1A]">
                {result === "failed" ? "Something went wrong. Please try again." : "This link is not valid, or it has expired."}
              </p>
            )}
            <form action={unsubscribeAction} className="mt-5">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className="rounded-xl bg-[#B61913] px-5 font-inter text-sm font-semibold text-white hover:bg-[#9A1410]">
                Yes, unsubscribe me
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
