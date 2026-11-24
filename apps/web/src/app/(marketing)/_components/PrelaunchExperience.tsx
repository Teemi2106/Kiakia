"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { subscribeToLaunchAction, type LaunchSignupState } from "@/app/actions/launch";
import type { CountdownParts } from "@/lib/launch/countdown";
import { LAUNCH_TICKET_REFERENCE } from "@/lib/launch/config";

const EMPTY_STATE: LaunchSignupState = {};
const COUNTDOWN_PARTS: readonly { key: keyof CountdownParts; label: string }[] = [
  { key: "days", label: "days" },
  { key: "hours", label: "hours" },
  { key: "minutes", label: "mins" },
  { key: "seconds", label: "secs" },
];

export function PrelaunchExperience({ launchAt, launchDate, initialCountdown }: {
  launchAt: string;
  launchDate: string;
  initialCountdown: CountdownParts | null;
}) {
  const [countdown, setCountdown] = useState(initialCountdown);
  const [signup, formAction, isPending] = useActionState(subscribeToLaunchAction, EMPTY_STATE);

  useEffect(() => {
    const tick = () => {
      const millisecondsRemaining = Date.parse(launchAt) - Date.now();
      if (millisecondsRemaining <= 0) {
        setCountdown(null);
        return false;
      }
      const remaining = Math.ceil(millisecondsRemaining / 1000);
      setCountdown({
        days: Math.floor(remaining / 86_400),
        hours: Math.floor((remaining % 86_400) / 3_600),
        minutes: Math.floor((remaining % 3_600) / 60),
        seconds: remaining % 60,
      });
      return true;
    };
    if (!tick()) return;
    const timer = window.setInterval(() => {
      if (!tick()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [launchAt]);

  return (
    <div className="kk-prelaunch">
      <section id="ticket" className="kk-prelaunch-stage" aria-labelledby="prelaunch-title">
        <div className="kk-prelaunch-intro">
          <span className="kk-prelaunch-eyebrow">The city is getting hungry</span>
          <h1 id="prelaunch-title">KiaKia is almost <span>ready to serve.</span></h1>
          <p>Good things take a little prep. Your next favourite meal is getting closer.</p>
        </div>

        <div className="kk-ticket-wrap">
          <div className="kk-ticket" aria-label={`KiaKia launch countdown, ${countdown ? "counting down" : "launch time reached"}`}>
            <Image
              src="/assets/kitchen-ticket-premium.png"
              alt=""
              width={1122}
              height={1402}
              priority
              className="kk-ticket-image"
            />
            <div className="kk-ticket-content">
              <div className="kk-ticket-brandline">
                <Image src="/assets/logo-mark.png" alt="KiaKia" width={1104} height={270} className="kk-ticket-logo" />
                <span className="kk-ticket-dot" aria-hidden="true" />
              </div>
              <div className="kk-ticket-rule" />
              <p className="kk-ticket-kicker">Kitchen status</p>
              <p className="kk-ticket-status">{countdown ? "Preparing to open" : "The kitchen is open"}</p>
              <p className="kk-ticket-message">Your first bite is getting closer.</p>

              {countdown ? (
                <div className="kk-countdown" role="timer" aria-label="Time remaining until launch">
                  {COUNTDOWN_PARTS.map(({ key, label }) => (
                    <div className="kk-countdown-unit" key={key}>
                      <span className="kk-countdown-number" key={`${key}-${countdown[key]}`}>{String(countdown[key]).padStart(2, "0")}</span>
                      <span className="kk-countdown-label">{label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Link className="kk-ticket-open-link" href="/home">Explore KiaKia <span aria-hidden="true">↗</span></Link>
              )}

              <p className="kk-ticket-launch-date">{launchDate} WAT</p>
              <div className="kk-ticket-footer">
                <span>{LAUNCH_TICKET_REFERENCE}</span>
                <span>Good things take a little prep.</span>
              </div>
            </div>
          </div>
          <span className="kk-ticket-orbit kk-ticket-orbit-one" aria-hidden="true" />
          <span className="kk-ticket-orbit kk-ticket-orbit-two" aria-hidden="true" />
        </div>
      </section>

      <section id="notify" className="kk-notify-card" aria-labelledby="notify-title">
        {signup.status === "success" ? (
          <div className="kk-notify-success" role="status" aria-live="polite">
            <span className="kk-success-stamp">Notification confirmed</span>
            <h2>You’re on the list!</h2>
            <p>{signup.welcomeQueued
              ? "Your KiaKia welcome email is on its way. We’ll send your launch note and relevant pre-launch updates here."
              : "You’re already on the list. We’ll send your launch note and relevant updates to this email."}</p>
            {signup.unsubscribeUrl && <Link href={signup.unsubscribeUrl} className="kk-unsubscribe-link">Unsubscribe from launch emails</Link>}
          </div>
        ) : (
          <>
            <span className="kk-notify-spark" aria-hidden="true">✳</span>
            <p className="kk-notify-eyebrow">A little heads-up, right on time</p>
            <h2 id="notify-title">Don’t miss the first serving.</h2>
            <p className="kk-notify-description">Leave your email. We’ll let you know the moment KiaKia is live.</p>
            <form action={formAction} className="kk-notify-form">
              <label className="kk-notify-label" htmlFor="launch-email">Your email address</label>
              <input
                id="launch-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                placeholder="you@example.com"
                required
                aria-describedby={signup.status === "error" ? "launch-form-message launch-consent" : "launch-consent"}
                className="kk-notify-input"
              />
              <label className="kk-consent-row" id="launch-consent">
                <input type="checkbox" name="consent" value="yes" required />
                <span>Email me the KiaKia launch announcement and relevant pre-launch updates. I can unsubscribe at any time. See our <Link href="/privacy">privacy policy</Link>.</span>
              </label>
              <div className="kk-honeypot" aria-hidden="true">
                <label htmlFor="launch-website">Leave this field empty</label>
                <input id="launch-website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              {signup.status === "error" && <p id="launch-form-message" className="kk-form-error" role="alert">{signup.message}</p>}
              <button type="submit" className="kk-notify-button" disabled={isPending}>
                {isPending ? "Saving your seat…" : "Notify me when it’s ready"}
                <span aria-hidden="true">↗</span>
              </button>
              <p className="kk-notify-privacy">Only launch news and relevant pre-launch updates. Unsubscribe any time.</p>
            </form>
          </>
        )}
      </section>
      <p className="kk-prelaunch-footnote">Made for Lagos appetites. Delivered fast fast.</p>
    </div>
  );
}
