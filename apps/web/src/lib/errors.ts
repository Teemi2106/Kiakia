/**
 * A Server Action's thrown error message is NOT automatically safe to show
 * a user — an unhandled Postgres/Supabase error can leak table names,
 * constraint internals, or stack details. AppError is the one kind of
 * error whose `.message` is pre-approved for display; everything else gets
 * a generic message and the real error goes to server logs only.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "unknown_error",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Converts any thrown value into a user-safe ActionResult. Logs the real
 * error server-side always; only forwards `.message` to the client when
 * the error is an AppError we deliberately authored to be user-facing.
 */
export function actionError(error: unknown, fallbackMessage = "Something went wrong. Please try again."): ActionResult<never> {
  if (error instanceof AppError) {
    return { ok: false, error: error.message };
  }

  console.error(error);
  return { ok: false, error: fallbackMessage };
}
