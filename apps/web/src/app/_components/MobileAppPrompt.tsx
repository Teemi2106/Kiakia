"use client";

import { BellRing, Download, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWebPushSubscription } from "@/lib/push/useWebPushSubscription";

interface MobileAppPromptProps {
  /** Guests can install KiaKia, but push alerts require an account. */
  enablePush: boolean;
}

interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type PhonePlatform = "ios" | "android" | "other";

const DISMISSAL_KEY = "kk-push-prompt-dismissed-until-v2";
const DISMISSAL_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function MobileAppPrompt({ enablePush }: MobileAppPromptProps) {
  const pathname = usePathname();
  const push = useWebPushSubscription(enablePush);
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<PhonePlatform>("other");
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [pushPending, setPushPending] = useState(false);
  const pwaPromptDismissed = useRef(false);

  const hasPushOption = enablePush && (push.status === "not_subscribed" || push.status === "denied");
  const pushUnavailableInPwa = enablePush && isStandalone && push.status === "unsupported";
  const hasPushPrompt = hasPushOption || pushUnavailableInPwa;
  const isPwaPushPrompt = isStandalone && hasPushPrompt;

  useEffect(() => {
    const ios =
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const media = window.matchMedia("(max-width: 767px)");
    const syncDevice = () => setIsMobile(media.matches);

    setPlatform(ios ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : "other");
    setIsStandalone(isStandaloneApp());
    syncDevice();
    setReady(true);
    media.addEventListener("change", syncDevice);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };
    const onAppInstalled = () => {
      setIsStandalone(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      media.removeEventListener("change", syncDevice);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!ready || (pathname.startsWith("/checkout") && !isPwaPushPrompt)) {
      setVisible(false);
      return;
    }

    const hasInstallOption = isMobile && !isStandalone;
    if (!hasInstallOption && !hasPushPrompt) {
      setVisible(false);
      return;
    }

    if (isPwaPushPrompt && pwaPromptDismissed.current) {
      setVisible(false);
      return;
    }

    // In an installed PWA, check again whenever the signed-in app surface
    // mounts. A saved browser-level dismissal must not hide the login prompt.
    if (!isPwaPushPrompt) {
      try {
        const dismissedUntil = Number(window.localStorage.getItem(DISMISSAL_KEY));
        if (dismissedUntil > Date.now()) {
          setVisible(false);
          return;
        }
      } catch {
        // Storage may be unavailable in private browsing; the prompt can still work.
      }
    }

    const timer = window.setTimeout(() => setVisible(true), 1800);
    return () => window.clearTimeout(timer);
  }, [enablePush, hasPushOption, hasPushPrompt, isMobile, isPwaPushPrompt, isStandalone, pathname, push.status, ready]);

  function dismiss() {
    if (isPwaPushPrompt) {
      pwaPromptDismissed.current = true;
    } else {
      try {
        window.localStorage.setItem(DISMISSAL_KEY, String(Date.now() + DISMISSAL_MS));
      } catch {
        // Dismiss for this render even when storage is unavailable.
      }
    }
    setVisible(false);
  }

  async function installApp() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setIsStandalone(true);
    } catch {
      setInstallPrompt(null);
    }
  }

  async function enableOrderAlerts() {
    setPushPending(true);
    try {
      await push.subscribe();
    } finally {
      setPushPending(false);
    }
  }

  const showInstallPrompt = isMobile && !isStandalone;

  if (!visible) return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={showInstallPrompt ? "Save KiaKia and enable order alerts" : "Enable KiaKia order alerts"}
      className="fixed bottom-28 left-3 right-3 z-[70] max-h-[60vh] overflow-y-auto rounded-2xl border border-kk-line bg-kk-card p-4 text-kk-ink shadow-[0_18px_50px_-16px_rgba(35,20,18,0.45)] sm:left-auto sm:right-4 sm:w-96 lg:bottom-24"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kk-red/10 text-kk-red-ink">
          {showInstallPrompt ? <Download className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-sora text-base font-semibold">
            {showInstallPrompt ? "Keep KiaKia close" : "Get order updates"}
          </h2>
          {showInstallPrompt && (
            <>
              <p className="mt-1 font-inter text-sm text-kk-cocoa">
                Save KiaKia to your home screen for quicker orders.
              </p>
              <p className="mt-2 font-inter text-xs leading-5 text-kk-cocoa">
                {platform === "ios"
                  ? "In Safari, tap Share, then Add to Home Screen and Add."
                  : platform === "android"
                    ? "In Chrome, tap ⋮, then Install app or Add to Home screen."
                    : "Open your browser menu or Share button, then choose Add to Home Screen."}
              </p>
              {installPrompt && (
                <button
                  type="button"
                  onClick={() => void installApp()}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-kk-red px-4 py-2.5 font-inter text-sm font-semibold text-white hover:bg-kk-red-deep"
                >
                  <Download className="size-4" />
                  Add KiaKia
                </button>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss prompt"
          className="rounded-lg p-1.5 text-kk-cocoa hover:bg-kk-sand"
        >
          <X className="size-4" />
        </button>
      </div>

      {enablePush && push.status === "not_subscribed" && (
        <div className="mt-4 border-t border-kk-line pt-3">
          <div className="flex items-start gap-2">
            <BellRing className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
            <div className="min-w-0 flex-1">
              <p className="font-inter text-sm font-semibold">Get order updates, even when you leave</p>
              {platform === "ios" && !isStandalone ? (
                <p className="mt-1 font-inter text-xs leading-5 text-kk-cocoa">
                  On iPhone, add KiaKia to your Home Screen first. Open it from the new icon to turn on alerts.
                </p>
              ) : (
                <>
                  <p className="mt-1 font-inter text-xs text-kk-cocoa">
                    We’ll let you know when your order changes.
                  </p>
                  <button
                    type="button"
                    onClick={() => void enableOrderAlerts()}
                    disabled={pushPending}
                    className="mt-2 rounded-xl border border-kk-red/30 px-3 py-2 font-inter text-xs font-semibold text-kk-red-ink hover:bg-kk-red/5 disabled:opacity-60"
                  >
                    {pushPending
                      ? "Turning alerts on…"
                      : isStandalone
                        ? "Yes, turn on notifications"
                        : "Turn on order alerts"}
                  </button>
                  {push.error && <p role="status" className="mt-2 font-inter text-xs text-kk-red-ink">{push.error}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {enablePush && push.status === "denied" && (
        <div className="mt-4 border-t border-kk-line pt-3">
          <div className="flex items-start gap-2">
            <BellRing className="mt-0.5 size-4 shrink-0 text-kk-red-ink" />
            <p className="font-inter text-xs leading-5 text-kk-cocoa">
              Order alerts are blocked. Open KiaKia&apos;s site settings in your browser, allow notifications, then come back here.
            </p>
          </div>
        </div>
      )}

      {pushUnavailableInPwa && (
        <p role="status" className="mt-4 border-t border-kk-line pt-3 font-inter text-xs leading-5 text-kk-cocoa">
          {push.error ?? "Push notifications aren’t available in this browser or app version."}
        </p>
      )}

      {enablePush && push.status === "subscribed" && (
        <p className="mt-3 border-t border-kk-line pt-3 font-inter text-xs font-medium text-kk-green-ink">
          Order alerts are on for this device.
        </p>
      )}
    </aside>
  );
}
