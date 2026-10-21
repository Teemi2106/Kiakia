/**
 * Length rules for admin messages. They mirror _message_check_content() in
 * migration 0094 (the database is the real gate); they exist so the form can say
 * "too long" before the round trip. The database checks the WORST CASE render:
 * {{first_name}} as 40 characters and {{store_name}} as 60.
 *
 *   text message  612 characters; 268 if it has anything beyond plain keyboard
 *                 characters (accents, emoji, curly quotes); promotions leave room
 *                 for the opt-out line: 440 / 90.
 *   email         subject 150 characters on one line; body 5000.
 */
export const EMAIL_BODY_MAX_CHARS = 5000;
export const SUBJECT_MAX_CHARS = 150;
export const REASON_MIN_CHARS = 3;
export const REASON_MAX_CHARS = 1000;

export const WORST_CASE_FIRST_NAME = "x".repeat(40);
export const WORST_CASE_STORE_NAME = "x".repeat(60);

/** True when the text holds anything beyond printable ASCII and line breaks, which makes the whole text message use the wider encoding. */
export function needsWideEncoding(text: string): boolean {
  return /[^ -~\n]/.test(text);
}

export function smsMaxChars(text: string, promotional: boolean): number {
  if (needsWideEncoding(text)) return promotional ? 90 : 268;
  return promotional ? 440 : 612;
}
