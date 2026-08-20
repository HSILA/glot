/**
 * Tests for the `resourcesApi` client + `computeFileHash`.
 *
 * The resources flow has unusual edges: (a) the R2 upload is a direct
 * fetch with no auth, distinct from the rest of the API surface, and
 * (b) the upload-deduplication path skips the R2 step entirely when
 * `upload_url` is empty. Both are easy to regress, so we cover them.
 *
 * Run with: `bun test src/lib/api/resources.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __resetForTests } from "./fetch-with-auth";
import { computeFileHash, resourcesApi, type Resource } from "./resources";
import {
  installFetchMock,
  installWindowMock,
  jsonResponse,
  restoreFetch,
  restoreWindow,
  type FetchMock,
} from "@/lib/test-utils";

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    content_hash: "deadbeef",
    name: "Doc.pdf",
    size_bytes: 1024,
    page_count: 4,
    is_public: false,
    extraction_status: "none",
    uploaded_at: "2025-01-01T00:00:00Z",
    processed_at: null,
    is_owner: true,
    ...overrides,
  };
}

let fetchMock: FetchMock;

beforeEach(() => {
  __resetForTests();
  installWindowMock();
  fetchMock = installFetchMock();
});

afterEach(() => {
  restoreFetch();
  restoreWindow();
});

describe("computeFileHash", () => {
  test("returns a hex SHA-256 of the file contents", async () => {
    // SHA-256 of "hello" is well-known.
    const expected =
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    const file = new File(["hello"], "test.txt", { type: "text/plain" });

    const hash = await computeFileHash(file);

    expect(hash).toBe(expected);
  });

  test("identical content produces identical hashes", async () => {
    const a = new File(["same"], "a.pdf");
    const b = new File(["same"], "b.pdf");
    expect(await computeFileHash(a)).toBe(await computeFileHash(b));
  });

  test("different content produces different hashes", async () => {
    const a = new File(["a"], "a.pdf");
    const b = new File(["b"], "b.pdf");
    expect(await computeFileHash(a)).not.toBe(await computeFileHash(b));
  });
});

describe("resourcesApi.getMyResources", () => {
  test("uses default limit/offset", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [makeResource()], total: 1, limit: 50, offset: 0 }),
    );

    const r = await resourcesApi.getMyResources();

    expect(r.items).toHaveLength(1);
    expect(fetchMock.calls[0].url).toBe(
      "/api/v1/resources?limit=50&offset=0",
    );
  });

  test("throws on non-OK", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 500 }));
    await expect(resourcesApi.getMyResources()).rejects.toThrow(
      "Failed to fetch resources",
    );
  });

  test("surfaces per-resource recovery flags", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({
        items: [
          makeResource({
            extraction_status: "processing",
            extraction_problem: true,
            can_resume_extraction: true,
          }),
        ],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    );

    const r = await resourcesApi.getMyResources();

    expect(r.items[0].extraction_problem).toBe(true);
    expect(r.items[0].can_resume_extraction).toBe(true);
  });
});

describe("resourcesApi.getPublicResources", () => {
  test("omits `search` when not given", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }),
    );

    await resourcesApi.getPublicResources();

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.pathname).toBe("/api/v1/resources/public");
    expect(url.searchParams.get("search")).toBeNull();
  });

  test("encodes search query when provided", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ items: [], total: 0, limit: 10, offset: 5 }),
    );

    await resourcesApi.getPublicResources("calc & physics", 10, 5);

    const url = new URL(fetchMock.calls[0].url, "http://localhost");
    expect(url.searchParams.get("search")).toBe("calc & physics");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });
});

describe("resourcesApi.requestUpload", () => {
  test("sends JSON body and returns the upload response", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ upload_url: "https://r2.example/x", resource_id: 10, expires_in: 60 }),
    );

    const res = await resourcesApi.requestUpload({
      name: "Doc",
      file_name: "Doc.pdf",
      content_type: "application/pdf",
      size_bytes: 200,
      content_hash: "abcd",
      is_public: false,
    });

    expect(res.resource_id).toBe(10);
    const call = fetchMock.calls[0];
    expect(call.url).toBe("/api/v1/resources/upload");
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(call.init?.body as string)).toMatchObject({
      name: "Doc",
      file_name: "Doc.pdf",
      content_type: "application/pdf",
    });
  });

  test("uses backend `detail` on failure", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "PDF too large" }, { status: 413 }),
    );

    await expect(
      resourcesApi.requestUpload({
        name: "Doc",
        file_name: "Doc.pdf",
        content_type: "application/pdf",
        size_bytes: 9999999999,
        content_hash: "abcd",
        is_public: false,
      }),
    ).rejects.toThrow("PDF too large");
  });
});

describe("resourcesApi.uploadFileToR2", () => {
  test("PUTs the file body as application/pdf", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 200 }));

    const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
    await resourcesApi.uploadFileToR2("https://r2.example/x", file);

    const call = fetchMock.calls[0];
    expect(call.url).toBe("https://r2.example/x");
    expect(call.init?.method).toBe("PUT");
    expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/pdf",
    );
  });

  test("throws on R2 failure", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 500 }));

    const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
    await expect(
      resourcesApi.uploadFileToR2("https://r2.example/x", file),
    ).rejects.toThrow("Failed to upload file to storage");
  });
});

describe("resourcesApi.deleteResource", () => {
  test("issues DELETE and returns void on success", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 204 }));

    await expect(resourcesApi.deleteResource(7)).resolves.toBeUndefined();
    expect(fetchMock.calls[0].url).toBe("/api/v1/resources/7");
    expect(fetchMock.calls[0].init?.method).toBe("DELETE");
  });

  test("uses parsed detail on failure", async () => {
    fetchMock.enqueue(() =>
      jsonResponse({ detail: "Not yours" }, { status: 403 }),
    );
    await expect(resourcesApi.deleteResource(7)).rejects.toThrow("Not yours");
  });
});

describe("resourcesApi.getDownloadUrl", () => {
  test("returns the `url` field from the response", async () => {
    fetchMock.enqueue(() => jsonResponse({ url: "https://r2.example/sig" }));

    const url = await resourcesApi.getDownloadUrl(3);

    expect(url).toBe("https://r2.example/sig");
    expect(fetchMock.calls[0].url).toBe("/api/v1/resources/3/download");
  });

  test("throws when the request fails", async () => {
    fetchMock.enqueue(() => new Response(null, { status: 500 }));
    await expect(resourcesApi.getDownloadUrl(3)).rejects.toThrow(
      "Failed to get download URL",
    );
  });
});
