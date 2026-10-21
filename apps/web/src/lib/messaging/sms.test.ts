import { describe, expect, it } from "vitest";
import { needsWideEncoding, smsMaxChars } from "./limits";
import { segmentLabel, smsStats } from "./sms";
import { firstNameOf, renderTemplate, unknownPlaceholders } from "./templates";

describe("smsStats", () => {
  it("counts nothing as zero segments", () => {
    expect(smsStats("")).toMatchObject({ characters: 0, segments: 0 });
  });

  it("fits 160 plain characters in one segment and splits at 153 after that", () => {
    expect(smsStats("a".repeat(160))).toMatchObject({ encoding: "basic", segments: 1 });
    expect(smsStats("a".repeat(161)).segments).toBe(2);
    expect(smsStats("a".repeat(306)).segments).toBe(2);
    expect(smsStats("a".repeat(307)).segments).toBe(3);
    expect(smsStats("a".repeat(612)).segments).toBe(4);
  });

  it("treats line breaks and printable ASCII as plain", () => {
    expect(smsStats("Line one\nLine two ~!@#$%^&*(){}[]").encoding).toBe("basic");
  });

  it("switches the whole message to the wider encoding for emoji, accents or curly quotes", () => {
    expect(smsStats("Hello \u{1F600}")).toMatchObject({ encoding: "unicode", segments: 1 });
    expect(smsStats("caf\u00e9").encoding).toBe("unicode");
    expect(smsStats("it\u2019s").encoding).toBe("unicode");
    expect(smsStats("\u4f60".repeat(70)).segments).toBe(1);
    expect(smsStats("\u4f60".repeat(71)).segments).toBe(2);
    expect(smsStats("\u4f60".repeat(135)).segments).toBe(3);
  });

  it("labels segments in plain words", () => {
    expect(segmentLabel(1)).toBe("1 text segment");
    expect(segmentLabel(3)).toBe("3 text segments");
  });
});

describe("text message limits (mirror _message_check_content)", () => {
  it("allows 612 plain characters, or 440 for a promotion", () => {
    expect(smsMaxChars("hello", false)).toBe(612);
    expect(smsMaxChars("hello", true)).toBe(440);
  });

  it("drops to 268 (90 for a promotion) when anything is beyond plain keyboard characters", () => {
    expect(needsWideEncoding("hello \u{1F600}")).toBe(true);
    expect(needsWideEncoding("hello\nthere")).toBe(false);
    expect(smsMaxChars("caf\u00e9", false)).toBe(268);
    expect(smsMaxChars("caf\u00e9", true)).toBe(90);
  });
});

describe("templates", () => {
  it("fills known fields, in any spacing or case, and drops tokens it cannot fill (as the database does)", () => {
    expect(renderTemplate("Hi {{first_name}}, {{ Store_Name }} is open. {{other}}", { first_name: "Ada", store_name: "Mama Put" })).toBe(
      "Hi Ada, Mama Put is open. ",
    );
  });

  it("strips braces and control characters from values and caps their length, so a name cannot add a field", () => {
    expect(renderTemplate("{{first_name}}", { first_name: "{{store_name}}Ada\n" })).toBe("store_nameAda");
    expect(renderTemplate("{{first_name}}", { first_name: "x".repeat(100) })).toHaveLength(40);
    expect(renderTemplate("{{store_name}}", { store_name: "x".repeat(100) })).toHaveLength(60);
  });

  it("never turns text into markup: it only substitutes strings", () => {
    expect(renderTemplate("<b>{{first_name}}</b>", { first_name: "<script>" })).toBe("<b><script></b>");
  });

  it("lists placeholders it cannot fill", () => {
    expect(unknownPlaceholders("{{first_name}} {{coupon}} {{ Coupon }}")).toEqual(["{{coupon}}", "{{ Coupon }}"]);
    expect(unknownPlaceholders("nothing here")).toEqual([]);
  });

  it("takes the first word as the first name", () => {
    expect(firstNameOf("  Ada Obi ")).toBe("Ada");
    expect(firstNameOf(null)).toBe("");
  });
});
