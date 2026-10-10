import { describe, expect, it } from "vitest";
import { emailSchema, loginSchema, passwordSchema, phoneSchema, registerSchema } from "./auth";

describe("phoneSchema", () => {
  it("accepts a well-formed Nigerian E.164 number", () => {
    expect(phoneSchema.safeParse("+2348012345678").success).toBe(true);
  });

  it("accepts local format and normalizes it to E.164", () => {
    const result = phoneSchema.safeParse("08012345678");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("+2348012345678");
  });

  it("accepts the country code without a leading +", () => {
    const result = phoneSchema.safeParse("2348012345678");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("+2348012345678");
  });

  it("trims surrounding whitespace and internal separators before matching", () => {
    const result = phoneSchema.safeParse(" 0801-234-5678 ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("+2348012345678");
  });

  it("rejects a number with the wrong digit count", () => {
    expect(phoneSchema.safeParse("+234801234567").success).toBe(false); // 9 digits, not 10
    expect(phoneSchema.safeParse("+23480123456789").success).toBe(false); // 11 digits
    expect(phoneSchema.safeParse("0801234567").success).toBe(false); // local, 10 digits
  });

  it("rejects a non-Nigerian country code", () => {
    expect(phoneSchema.safeParse("+14155552671").success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("accepts a normal address", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects a string with no @", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    const result = emailSchema.safeParse("  user@example.com  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("user@example.com");
  });
});

describe("passwordSchema", () => {
  it("accepts a password with letters and numbers, 8+ chars", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(passwordSchema.safeParse("ab1").success).toBe(false);
  });

  it("rejects a letters-only password (no number)", () => {
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
  });

  it("rejects a digits-only password (no letter)", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+2348012345678",
    password: "abcd1234",
    confirmPassword: "abcd1234",
  };

  it("accepts a fully valid registration payload", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("normalizes a local-format phone number within the full payload", () => {
    const result = registerSchema.safeParse({ ...valid, phone: "08012345678" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+2348012345678");
  });

  it("rejects mismatched password/confirmPassword", () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("rejects a one-character full name", () => {
    expect(registerSchema.safeParse({ ...valid, fullName: "A" }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts an email + any non-empty password (no strength check on login)", () => {
    expect(loginSchema.safeParse({ email: "ada@example.com", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false);
  });
});
