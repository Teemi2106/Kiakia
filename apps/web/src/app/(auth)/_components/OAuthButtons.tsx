/**
 * The "OR CONTINUE WITH" Google/Apple pair from the Figma screens, rendered
 * disabled. Wiring real OAuth needs a Google/Apple OAuth app + client
 * credentials configured in the Supabase dashboard, which don't exist for
 * this project yet; shipping enabled buttons that error on click would be
 * worse than not having them.
 *
 * They stay in the redesign for the same reason they were drawn: the divider
 * gives the form a natural end, and the pair marks where social sign-in will
 * land so its arrival isn't a layout change. `disabled` + the "coming soon"
 * line keep the promise honest.
 */
export function OAuthButtons() {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-kk-line/50" />
        <span className="font-inter text-[10px] font-semibold uppercase tracking-[0.2em] text-kk-cocoa/55">
          Or continue with
        </span>
        <div className="h-px flex-1 bg-kk-line/50" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <OAuthButton label="Google" icon={<GoogleIcon />} />
        <OAuthButton label="Apple" icon={<AppleIcon />} />
      </div>

      <p className="mt-3.5 text-center font-inter text-[11px] text-kk-cocoa/55">
        Social sign-in is coming soon — use email and password for now.
      </p>
    </div>
  );
}

function OAuthButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className="flex h-12 items-center justify-center gap-2.5 rounded-2xl border border-kk-line/70 bg-white font-inter text-sm font-semibold text-kk-ink opacity-55"
    >
      {icon}
      {label}
    </button>
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

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.78 1.94c.65-.79 1.47-1.35 2.42-1.94.02.75-.25 1.46-.67 2.05-.46.65-1.05 1.13-1.79 1.58-.68.42-1.45.73-2.3.84-.02-.78.27-1.48.7-2.08.41-.57.98-1.08 1.64-1.45zM9.5 3.06c-1.31 0-2.45-.75-3.76-.75-1.66 0-3.32.91-4.19 2.34-1.25 2.08-.88 5.4.79 8.08.58.93 1.33 1.95 2.3 1.95.92 0 1.2-.6 2.44-.6 1.23 0 1.48.6 2.44.6.98 0 1.82-1.15 2.4-2.08a8.35 8.35 0 0 0 1.02-2.35c-1.38-.59-2.33-1.94-2.33-3.54 0-1.41.78-2.56 1.9-3.17a4.85 4.85 0 0 0-2.01-.48z"
        fill="#1C1B1B"
      />
    </svg>
  );
}
