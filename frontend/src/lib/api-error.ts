/**
 * Parse error responses from the FastAPI backend.
 *
 * FastAPI returns validation errors as:
 * { "detail": [{ "msg": "...", "loc": [...], ... }] }
 * regular errors as:
 * { "detail": "Error message" }
 * and structured errors (e.g. the review endpoint's stale-version conflict,
 * whose detail carries a `code`, `message`, fresh card and summary) as an
 * object detail.
 */

export class ApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** Raw `detail` field from the response body (string, array, object, or null). */
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function parseApiError(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "An error occurred";
  }

  const errorData = data as { detail?: unknown };

  // Handle array of validation errors (422 responses)
  if (Array.isArray(errorData.detail)) {
    const messages = errorData.detail
      .map((err: { msg?: string }) => {
        if (err.msg) {
          // Remove "Value error, " prefix that Pydantic adds
          return err.msg.replace(/^Value error,\s*/i, "");
        }
        return null;
      })
      .filter(Boolean);

    return messages.length > 0 ? messages.join(". ") : "Validation failed";
  }

  // Handle structured errors: { detail: { code, message, ... } }
  if (typeof errorData.detail === "object" && errorData.detail !== null) {
    const detail = errorData.detail as { message?: unknown };
    if (typeof detail.message === "string") {
      return detail.message;
    }
  }

  // Handle string error message
  if (typeof errorData.detail === "string") {
    return errorData.detail;
  }

  return "An error occurred";
}

/** Build an ApiError from a non-ok response. Never throws on parse failure. */
export async function apiErrorFromResponse(
  response: Response,
  fallback: string,
): Promise<ApiError> {
  const data: unknown = await response.json().catch(() => null);
  const message = data ? parseApiError(data) : fallback;
  const detail =
    data && typeof data === "object" && "detail" in data
      ? (data as { detail?: unknown }).detail
      : null;
  return new ApiError(message, response.status, detail);
}
