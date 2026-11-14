"use client";

import { startGoogleOAuth, type OAuthIntent } from "@/app/actions/auth";
import { useState, useTransition } from "react";

export function OAuthButtons({
  next = null,
  intent = "customer",
  initialError = null,
}: {
  next?: string | null;
  intent?: OAuthIntent;
  initialError?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(initialError);

  function continueWithGoogle() {
    setError(null);
    startTransition(async () => {
      const result = await startGoogleOAuth(next, intent);
      if (result.url) {
        window.location.assign(result.url);
      } else {
        setError(result.error ?? "Google sign-in is unavailable right now. Please try again.");
      }
    });
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-kk-line/50" />
        <span className="font-inter text-[10px] font-semibold uppercase tracking-[0.2em] text-kk-cocoa/55">
          Or continue with
        </span>
        <div className="h-px flex-1 bg-kk-line/50" />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={pending}
          className="flex h-12 items-center justify-center gap-2.5 rounded-2xl border border-kk-line/70 bg-kk-card font-inter text-sm font-semibold text-kk-ink transition-colors hover:bg-kk-line/20 disabled:cursor-wait disabled:opacity-60"
        >
          <GoogleIcon />
          {pending ? "Opening Google…" : "Google"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3.5 text-center font-inter text-xs text-danger">{error}</p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M19.6 10.23c0-.82-.07-1.42-.22-2.05H10v3.72h5.5c-.11.9-.71 2.25-2.04 3.16l-.02.12 2.96 2.3.2.02c1.85-1.71 2.92-4.23 2.92-7.27z"
        fill="#4285F4"
      />
      <path
        d="M10 20c2.64 0 4.86-.87 6.48-2.37l-3.09-2.4c-.83.58-1.93.98-3.39.98-2.59 0-4.79-1.71-5.57-4.08l-.11.01-3.02 2.34-.04.1C2.54 16.64 5.99 20 10 20z"
        fill="#34A853"
      />
      <path
        d="M4.43 12.13a6.02 6.02 0 0 1 0-4.26v-.12L1.4 5.4l-.09.04a9.95 9.95 0 0 0 0 9.12l3.12-2.43z"
        fill="#FBBC05"
      />
      <path
        d="M10 3.58c1.83 0 3.07.79 3.78 1.45l2.76-2.7C14.86.9 12.64 0 10 0 5.99 0 2.54 3.36 1.31 7.7l3.11 2.42C5.21 5.29 7.41 3.58 10 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

