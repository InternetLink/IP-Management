import {NextRequest} from "next/server";
import {describe, expect, it, vi} from "vitest";

import {POST} from "../src/app/api/[...path]/route";

describe("API proxy request boundary", () => {
  it("forwards only allowed browser headers and injects the server session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {status: 200}),
    );

    try {
      const request = new NextRequest("http://localhost/api/prefixes/missing/generate-ips", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-token",
          cookie: "ipam_session=server-session-token; ipam_csrf=csrf-token; unrelated=value",
          "content-type": "application/json",
          "x-bootstrap-token": "browser-bootstrap-token",
          "x-csrf-token": "csrf-token",
          "x-forwarded-for": "203.0.113.10",
          origin: "http://localhost:3003",
        },
        body: "{}",
      });

      await POST(request, {params: Promise.resolve({path: ["prefixes", "missing", "generate-ips"]})});

      expect(fetchMock).toHaveBeenCalledOnce();
      const init = fetchMock.mock.calls[0]?.[1];
      const forwardedHeaders = new Headers(init?.headers);
      expect(forwardedHeaders.get("accept")).toBe("application/json");
      expect(forwardedHeaders.get("content-type")).toBe("application/json");
      expect(forwardedHeaders.get("authorization")).toBe("Bearer server-session-token");
      expect(forwardedHeaders.has("cookie")).toBe(false);
      expect(forwardedHeaders.has("x-bootstrap-token")).toBe(false);
      expect(forwardedHeaders.has("x-csrf-token")).toBe(false);
      expect(forwardedHeaders.has("x-forwarded-for")).toBe(false);
      expect(forwardedHeaders.has("origin")).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
