import { z } from "zod";

// Accepts what a Nigerian rider or customer actually types - local format
// (0XXXXXXXXXX, 11 digits) or international (+234XXXXXXXXXX / 234XXXXXXXXXX)
// - and normalizes every accepted shape down to the one this app stores and
// dials everywhere else: +234 followed by 10 digits. Collected as a profile
// field on registration (§14: phone-first identity matters even though the
// auth *mechanism* itself is email+password, per the Figma registration
// form).
function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");

  if (/^\+234\d{10}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;

  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeNigerianPhone(value);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a Nigerian number as 0XXXXXXXXXX or +234XXXXXXXXXX",
      });
      return z.NEVER;
    }
    return normalized;
  });

// Blank means "not given"; anything typed must still be a valid number.
const optionalPhoneSchema = z
  .string()
  .nullish()
  .transform((value) => (value?.trim() ? value : undefined))
  .pipe(phoneSchema.optional());

export const emailSchema = z.string().trim().email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Be at least 8 characters long")
  .regex(/[a-zA-Z]/, "Contain at least one letter")
  .regex(/\d/, "Contain at least one number");

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name"),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const customerRegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name"),
    email: emailSchema,
    phone: optionalPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});
