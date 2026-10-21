import { needsWideEncoding } from "./limits";

/**
 * Text-message length maths, shared by the compose form (live counter) and the
 * validation schema. Plain keyboard characters fit 160 in one text (153 each
 * when it has to be split); anything else (emoji, accents, curly quotes) makes
 * the whole message use a wider encoding that fits only 70 (67 each when split).
 * Same encoding rule the database applies when it checks the limit.
 */

export interface SmsStats {
  readonly characters: number;
  readonly encoding: "basic" | "unicode";
  readonly segments: number;
}

export function smsStats(text: string): SmsStats {
  const wide = needsWideEncoding(text);
  const units = text.length; // UTF-16 units: one each for plain text, and what the wider encoding counts
  const [single, multi] = wide ? [70, 67] : [160, 153];
  return {
    characters: Array.from(text).length,
    encoding: wide ? "unicode" : "basic",
    segments: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi),
  };
}

/** "1 text segment" / "3 text segments". */
export function segmentLabel(segments: number): string {
  return `${segments} text segment${segments === 1 ? "" : "s"}`;
}
