/**
 * Tests for `parseApiError`, which converts FastAPI error response bodies
 * into user-facing strings. The toast/alert messages everywhere in the
 * app flow through this function, so a regression here silently degrades
 * every error UI in the product.
 *
 * Run with: `bun test src/lib/api-error.test.ts`
 */

import { describe, expect, test } from "bun:test";

import { parseApiError } from "./api-error";

describe("parseApiError", () => {
  test("string detail is returned verbatim", () => {
    expect(parseApiError({ detail: "Invalid credentials" })).toBe(
      "Invalid credentials",
    );
  });

  test("pydantic validation array is joined with periods", () => {
    const body = {
      detail: [
        { msg: "field required", loc: ["body", "email"] },
        { msg: "value is not a valid email", loc: ["body", "email"] },
      ],
    };
    expect(parseApiError(body)).toBe(
      "field required. value is not a valid email",
    );
  });

  test("strips the `Value error, ` prefix that Pydantic adds", () => {
    const body = {
      detail: [
        { msg: "Value error, must be at least 8 characters", loc: ["body", "password"] },
        { msg: "value error, lowercase prefix too", loc: ["body", "password"] },
      ],
    };
    // Both casing variants of the prefix should be stripped.
    expect(parseApiError(body)).toBe(
      "must be at least 8 characters. lowercase prefix too",
    );
  });

  test("validation entries without a `msg` field are skipped", () => {
    const body = {
      detail: [
        { loc: ["body", "email"] },
        { msg: "required" },
      ],
    };
    expect(parseApiError(body)).toBe("required");
  });

  test("empty validation array falls back to a generic message", () => {
    expect(parseApiError({ detail: [] })).toBe("Validation failed");
  });

  test("validation array with only entries missing msg falls back too", () => {
    expect(parseApiError({ detail: [{ loc: ["body"] }] })).toBe(
      "Validation failed",
    );
  });

  test("missing detail field falls back to a generic message", () => {
    expect(parseApiError({})).toBe("An error occurred");
    expect(parseApiError({ message: "oops" })).toBe("An error occurred");
  });

  test("non-object / nullish input is handled defensively", () => {
    expect(parseApiError(null)).toBe("An error occurred");
    expect(parseApiError(undefined)).toBe("An error occurred");
    expect(parseApiError("oops")).toBe("An error occurred");
    expect(parseApiError(42)).toBe("An error occurred");
  });

  test("non-string, non-array detail falls back", () => {
    // A backend bug could send a number or object — make sure we still
    // return a string instead of crashing the toast call site.
    expect(parseApiError({ detail: 500 })).toBe("An error occurred");
    expect(parseApiError({ detail: { nested: true } })).toBe("An error occurred");
  });
});
