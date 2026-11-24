export const LAUNCH_AT_ISO = "2026-12-15T07:00:00+01:00";
export const LAUNCH_CONSENT_VERSION = "launch-list-v2";
export const LAUNCH_TICKET_REFERENCE = "KK-LAUNCH-001";

export function formatLaunchDate() {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(LAUNCH_AT_ISO));
}
