import { Button } from "@kiakia/ui";

/**
 * Matches the Figma "OR CONTINUE WITH" Google/Apple buttons — rendered
 * disabled. Wiring real OAuth needs a Google/Apple OAuth app + client
 * credentials configured in the Supabase dashboard, which don't exist for
 * this project yet; shipping enabled buttons that error on click would be
 * worse than not having them.
 */
export function OAuthButtons() {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-ink-muted">OR CONTINUE WITH</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" disabled title="Coming soon">
          Google
        </Button>
        <Button type="button" variant="secondary" disabled title="Coming soon">
          Apple
        </Button>
      </div>
    </div>
  );
}
