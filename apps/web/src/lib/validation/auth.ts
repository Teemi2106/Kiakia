import { z } from "zod";

// Nigerian E.164 numbers: +234 followed by 10 digits. Collected as a
// profile field on registration (§14: phone-first identity matters even
// though the auth *mechanism* itself is email+password, per the Figma
// registration form).
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+234\d{10}$/, "Enter a Nigerian number as +234XXXXXXXXXX");

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

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});
