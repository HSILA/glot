/**
 * Parse error responses from the FastAPI backend.
 * 
 * FastAPI returns validation errors as:
 * { "detail": [{ "msg": "...", "loc": [...], ... }] }
 * 
 * And regular errors as:
 * { "detail": "Error message" }
 */
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

  // Handle string error message
  if (typeof errorData.detail === "string") {
    return errorData.detail;
  }

  return "An error occurred";
}
