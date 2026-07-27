import { describe, it, expect, afterEach } from "vitest";
import { getClient, formatApiError } from "./client.js";
import { credentialStore } from "./credential-store.js";

const ORIGINAL_ENV_TOKEN = process.env.CREWHU_API_TOKEN;

afterEach(() => {
  if (ORIGINAL_ENV_TOKEN === undefined) {
    delete process.env.CREWHU_API_TOKEN;
  } else {
    process.env.CREWHU_API_TOKEN = ORIGINAL_ENV_TOKEN;
  }
});

describe("getClient — token resolution", () => {
  it("throws a clear error when neither request credentials nor env var are set", () => {
    delete process.env.CREWHU_API_TOKEN;
    expect(() => getClient()).toThrow(/Crewhu API token not available/);
  });

  it("falls back to CREWHU_API_TOKEN when no request-scoped credentials exist", () => {
    process.env.CREWHU_API_TOKEN = "env-token-a";
    expect(() => getClient()).not.toThrow();
  });

  it("prefers request-scoped credentials over the env var when both are present", async () => {
    process.env.CREWHU_API_TOKEN = "env-token-should-be-ignored";
    let threw = false;
    await credentialStore.run({ apiToken: "request-scoped-token" }, async () => {
      try {
        getClient();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });
});

describe("getClient — per-token cache (tenant isolation)", () => {
  it("returns the SAME client instance for the same token", () => {
    process.env.CREWHU_API_TOKEN = "cache-test-token-a";
    const first = getClient();
    const second = getClient();
    expect(first).toBe(second);
  });

  it("returns a DIFFERENT client instance for a different token", async () => {
    let clientA: unknown;
    let clientB: unknown;
    await credentialStore.run({ apiToken: "tenant-a-token" }, async () => {
      clientA = getClient();
    });
    await credentialStore.run({ apiToken: "tenant-b-token" }, async () => {
      clientB = getClient();
    });
    expect(clientA).not.toBe(clientB);
  });

  /**
   * The security-load-bearing property this file's own docstring claims:
   * "the cache key is the secret itself, which keeps tenants isolated."
   * Simulate two concurrent gateway requests (overlapping ALS contexts,
   * not sequential) and confirm each resolves its OWN token's client,
   * never the other's — the actual cross-tenant-leak class this pattern
   * exists to prevent.
   */
  it("does not leak a client across two CONCURRENT request-scoped contexts", async () => {
    const seen: Record<string, unknown> = {};

    const requestA = credentialStore.run({ apiToken: "concurrent-token-a" }, async () => {
      await new Promise((r) => setTimeout(r, 10)); // yield, let B start
      seen.a = getClient();
    });
    const requestB = credentialStore.run({ apiToken: "concurrent-token-b" }, async () => {
      seen.b = getClient();
    });

    await Promise.all([requestA, requestB]);

    expect(seen.a).not.toBe(seen.b);

    // And each token independently still resolves to its own cached instance.
    let recheckA: unknown;
    await credentialStore.run({ apiToken: "concurrent-token-a" }, async () => {
      recheckA = getClient();
    });
    expect(recheckA).toBe(seen.a);
  });
});

describe("formatApiError", () => {
  it("includes the HTTP status when the error carries a statusCode", () => {
    const err = Object.assign(new Error("Not Found"), { statusCode: 404 });
    expect(formatApiError(err)).toBe("Not Found (HTTP 404)");
  });

  it("omits the status suffix when the error has no statusCode", () => {
    const err = new Error("Something broke");
    expect(formatApiError(err)).toBe("Something broke");
  });

  it("stringifies a non-Error thrown value", () => {
    expect(formatApiError("a raw string throw")).toBe("a raw string throw");
  });

  it("stringifies a plain object thrown value", () => {
    expect(formatApiError({ weird: true })).toBe(String({ weird: true }));
  });
});
