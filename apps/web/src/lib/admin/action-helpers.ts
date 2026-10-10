import "server-only";

/** Result shape every admin form action returns — same as the vendor actions' FormState. */
export interface FormState {
  readonly error?: string;
  readonly success?: boolean;
  /** Shown instead of the default confirmation when a success needs explaining. */
  readonly message?: string;
}

interface RpcError {
  readonly message: string;
  readonly code?: string;
}

/**
 * Turns an admin RPC failure into a message that is safe to show. The admin
 * RPCs (0080/0081) raise check_violation (23514) and unique_violation (23505)
 * with messages written for the admin ("vendor available balance is 60000
 * kobo, cannot pay out 60001 kobo"), so those pass through minus the
 * "function_name: " prefix. Authority failures and missing rows get fixed
 * wording; everything else is logged and replaced, because an unmapped
 * Postgres message can name tables or constraints.
 */
export function rpcFailureMessage(error: RpcError): string {
  switch (error.code) {
    case "23514":
    case "23505":
      return error.message.replace(/^[a-z_]+: /, "");
    case "42501":
      return "You don't have permission to do that.";
    case "P0002":
      return "That record no longer exists.";
    default:
      console.error("admin rpc failed", error);
      return "Something went wrong. Please try again.";
  }
}

/** A form field as a string, or undefined when absent — what the zod schemas expect. */
export function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
