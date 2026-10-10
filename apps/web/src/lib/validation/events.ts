import { z } from "zod";

/**
 * Input schema for logCustomerEventAction. Only the four event types
 * log_customer_event() will accept from a client: cart_add / cart_remove are
 * written exclusively by cart_items triggers (0084_customer_events.sql), so a
 * client can never forge them - they are deliberately not in this list.
 *
 * No customer id appears here (or anywhere on the path): the RPC always
 * records auth.uid().
 */
export const CLIENT_LOGGABLE_EVENT_TYPES = ["view_vendor", "view_item", "search", "recommendation_click"] as const;

export const SEARCH_QUERY_MAX_LENGTH = 80;

export const customerEventSchema = z
  .object({
    eventType: z.enum(CLIENT_LOGGABLE_EVENT_TYPES),
    vendorId: z.string().uuid().optional(),
    menuItemId: z.string().uuid().optional(),
    searchQuery: z.string().trim().max(SEARCH_QUERY_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (value.eventType === "view_vendor") need(Boolean(value.vendorId), "vendorId", "vendorId is required");
    if (value.eventType === "view_item" || value.eventType === "recommendation_click") {
      need(Boolean(value.menuItemId), "menuItemId", "menuItemId is required");
    }
    if (value.eventType === "search") need(Boolean(value.searchQuery), "searchQuery", "searchQuery is required");
  });

export type CustomerEventInput = z.input<typeof customerEventSchema>;
