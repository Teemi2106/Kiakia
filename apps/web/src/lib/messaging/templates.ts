/**
 * The few merge fields an admin can put in a message. The sending worker fills
 * them in per person; the preview here uses a made-up sample so the admin sees
 * roughly what will arrive. Text is only ever rendered as text (React escapes
 * it), never as HTML.
 */

export const MERGE_FIELDS = ["first_name", "store_name"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export function mergeFieldToken(field: MergeField): string {
  return `{{${field}}}`;
}

/** Placeholder names used in `text` that are not one of the supported merge fields. */
export function unknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!(MERGE_FIELDS as readonly string[]).includes(name)) unknown.add(match[0]);
  }
  return [...unknown];
}

/**
 * Fills the merge fields the way the database does when it queues a message:
 * values lose control characters and braces and are capped (40 / 60), and any
 * other {{...}} token disappears.
 */
export function renderTemplate(text: string, values: Partial<Record<MergeField, string>>): string {
  const clean = (value: string | undefined, max: number) => (value ?? "").replace(/[\x00-\x1f\x7f-\x9f{}]/g, "").trim().slice(0, max);
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, () => clean(values.first_name, 40))
    .replace(/\{\{\s*store_name\s*\}\}/gi, () => clean(values.store_name, 60))
    .replace(/\{\{[^{}]*\}\}/g, "");
}

/** First word of a display name, which is what {{first_name}} becomes. */
export function firstNameOf(displayName: string | null | undefined): string {
  return displayName?.trim().split(/\s+/)[0] ?? "";
}
