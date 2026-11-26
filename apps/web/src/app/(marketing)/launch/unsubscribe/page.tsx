import type { Metadata } from "next";
import Link from "next/link";
import { unsubscribeFromLaunchAction } from "@/app/actions/launch";
import { canUnsubscribeFromLaunch } from "@/lib/launch/unsubscribe";

export const metadata: Metadata = {
  title: "Launch email preferences",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function LaunchUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string }> }) {
  const { token, result } = await searchParams;
  const valid = await canUnsubscribeFromLaunch(token);

  return (
    <main className="kk-unsubscribe-page">
      <div className="kk-unsubscribe-panel">
        <span className="kk-prelaunch-eyebrow">KiaKia launch updates</span>
        {result === "unsubscribed" ? (
          <>
            <h1>You’re unsubscribed.</h1>
            <p>We’ve removed this address from launch announcements.</p>
          </>
        ) : valid ? (
          <>
            <h1>Leave the list?</h1>
            <p>Confirm below and we’ll stop sending launch announcements to this address.</p>
            <form action={unsubscribeFromLaunchAction}>
              <input type="hidden" name="token" value={token} />
              <button className="kk-notify-button" type="submit">Unsubscribe from launch updates</button>
            </form>
          </>
        ) : (
          <>
            <h1>This link has expired.</h1>
            <p>It may already have been used. You can manage launch updates by contacting KiaKia support.</p>
          </>
        )}
        <Link href="/" className="kk-unsubscribe-back">Back to KiaKia</Link>
      </div>
    </main>
  );
}
