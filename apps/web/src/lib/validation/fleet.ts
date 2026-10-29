import { z } from "zod";
import { uuidSchema } from "./admin";

/**
 * Inputs for the fleet console and the admin fleet screens. The database
 * (0113) re-validates all of this; these exist to answer with a clear form
 * message instead of a Postgres one.
 */

/** The longest note a manager may text riders; the RPC adds a short sender prefix and enforces the SMS limit. */
export const FLEET_MESSAGE_MAX_CHARS = 300;

export const fleetMessageSchema = z.object({
  riderIds: z
    .array(uuidSchema)
    .min(1, "Choose at least one rider")
    .max(50, "You can message at most 50 riders at a time"),
  body: z
    .string()
    .trim()
    .min(2, "Write a message")
    .max(FLEET_MESSAGE_MAX_CHARS, `Keep the message under ${FLEET_MESSAGE_MAX_CHARS} characters`),
});

const adminReason = z
  .string()
  .trim()
  .max(1000, "Keep the note under 1000 characters")
  .transform((value) => value || undefined)
  .optional();

export const createFleetSchema = z.object({
  name: z.string().trim().min(2, "The fleet name needs at least 2 characters").max(80, "Keep the fleet name under 80 characters"),
  reason: adminReason,
});

export const addFleetManagerSchema = z.object({
  fleetId: uuidSchema,
  userId: z.string().uuid("Search for the person and choose them from the list"),
  reason: adminReason,
});

export const removeFleetManagerSchema = z.object({
  fleetId: uuidSchema,
  userId: uuidSchema,
  reason: adminReason,
});

export const setFleetStatusSchema = z.object({
  fleetId: uuidSchema,
  status: z.enum(["active", "suspended"]),
  reason: adminReason,
});

/** A blank fleet detaches the rider. */
export const setRiderFleetSchema = z.object({
  riderId: uuidSchema,
  fleetId: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .pipe(uuidSchema.optional())
    .optional(),
  reason: adminReason,
});
