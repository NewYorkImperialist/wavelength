import "server-only";

/** Error codes the client can branch on, deliberately free of detail. */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVER_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/**
 * Wrap a route handler so thrown ApiErrors become clean JSON responses and
 * anything unexpected becomes a 500 with no internals leaked to the client.
 */
export async function handleRoute(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Deliberately opaque: an internal message could describe game state.
    console.error("[wavelength] unhandled route error", error);
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
