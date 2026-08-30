/**
 * Real handler-invocation coverage for the surveys domain: mocks the
 * underlying CrewhuClient and exercises surveysHandler.handleCall directly,
 * asserting outbound call shape and response transformation — including the
 * client-side sentiment filtering this domain leans on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    surveys: {
      list: vi.fn(),
      get: vi.fn(),
      search: vi.fn(),
    },
  };
  return { mockClient };
});

vi.mock("../utils/client.js", () => ({
  getClient: () => mockClient,
  formatApiError: (err: unknown) => {
    if (err instanceof Error) {
      const status = (err as { statusCode?: number }).statusCode;
      return status ? `${err.message} (HTTP ${status})` : err.message;
    }
    return String(err);
  },
}));

import { surveysHandler } from "./surveys.js";

function text(result: Awaited<ReturnType<typeof surveysHandler.handleCall>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

describe("surveysHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tools", () => {
    it("exports the expected survey tool names", () => {
      expect(surveysHandler.tools.map((t) => t.name)).toEqual([
        "crewhu_surveys_list",
        "crewhu_surveys_get",
        "crewhu_surveys_search",
        "crewhu_surveys_detractors",
        "crewhu_surveys_promoters",
      ]);
    });

    it("requires query on crewhu_surveys_search and id on crewhu_surveys_get", () => {
      const search = surveysHandler.tools.find((t) => t.name === "crewhu_surveys_search");
      const get = surveysHandler.tools.find((t) => t.name === "crewhu_surveys_get");
      expect(search?.inputSchema.required).toEqual(["query"]);
      expect(get?.inputSchema.required).toEqual(["id"]);
    });
  });

  describe("crewhu_surveys_list", () => {
    it("defaults to active-only (inactive: false) when include_inactive is not set", async () => {
      mockClient.surveys.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await surveysHandler.handleCall("crewhu_surveys_list", {});

      expect(mockClient.surveys.list).toHaveBeenCalledWith({ limit: 50, step: 1, inactive: false });
    });

    it("omits the inactive filter when include_inactive is true", async () => {
      mockClient.surveys.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await surveysHandler.handleCall("crewhu_surveys_list", { include_inactive: true });

      expect(mockClient.surveys.list).toHaveBeenCalledWith({ limit: 50, step: 1 });
    });

    it("passes since through as an _updated_at $gte filter", async () => {
      mockClient.surveys.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await surveysHandler.handleCall("crewhu_surveys_list", { since: "2026-01-01T00:00:00Z" });

      expect(mockClient.surveys.list).toHaveBeenCalledWith({
        limit: 50,
        step: 1,
        inactive: false,
        _updated_at: { $gte: "2026-01-01T00:00:00Z" },
      });
    });

    it("filters the returned page client-side by sentiment", async () => {
      mockClient.surveys.list.mockResolvedValue({
        items: [
          { _id: "s1", rating: "5", customer_data: { name: "Acme" } },
          { _id: "s2", rating: "-5", customer_data: { name: "Beta" } },
        ],
        total: 2,
        hasMore: false,
      });

      const result = await surveysHandler.handleCall("crewhu_surveys_list", { sentiment: "positive" });

      const body = text(result);
      expect(body).toContain("(1 shown");
      expect(body).toContain("Acme");
      expect(body).not.toContain("Beta");
    });
  });

  describe("crewhu_surveys_get", () => {
    it("fetches a survey by id and formats sentiment, ticket, and comment", async () => {
      mockClient.surveys.get.mockResolvedValue({
        _id: "s1",
        rating: "5",
        rating_label: "Great!",
        customer_data: { name: "Acme", contact_name: "Jane" },
        ticket_num: "T-100",
        summary: "Printer issue",
        comment: "Fixed fast",
        survey_type_code: "typResolved",
        closed: "2026-01-01T00:00:00Z",
        employees: ["u1", "u2"],
        reviewed: true,
      });

      const result = await surveysHandler.handleCall("crewhu_surveys_get", { id: "s1" });

      expect(mockClient.surveys.get).toHaveBeenCalledWith("s1");
      const body = text(result);
      expect(body).toContain("Acme");
      expect(body).toContain("Great!");
      expect(body).toContain("T-100");
      expect(body).toContain("Fixed fast");
      expect(body).toContain("**Reviewed by manager:** Yes");
    });
  });

  describe("crewhu_surveys_search", () => {
    it("passes the query and limit through to client.surveys.search", async () => {
      mockClient.surveys.search.mockResolvedValue({ items: [], total: 0, size: 0 });

      await surveysHandler.handleCall("crewhu_surveys_search", { query: "refund", limit: 25 });

      expect(mockClient.surveys.search).toHaveBeenCalledWith("refund", { limit: 25 });
    });

    it("defaults limit to 100 when not provided", async () => {
      mockClient.surveys.search.mockResolvedValue({ items: [], total: 0, size: 0 });

      await surveysHandler.handleCall("crewhu_surveys_search", { query: "refund" });

      expect(mockClient.surveys.search).toHaveBeenCalledWith("refund", { limit: 100 });
    });
  });

  describe("crewhu_surveys_detractors", () => {
    it("fetches a full page and filters to negative sentiment only, honoring the limit", async () => {
      mockClient.surveys.list.mockResolvedValue({
        items: [
          { _id: "s1", rating: "-5", customer_data: { name: "Detractor A" } },
          { _id: "s2", rating: "5", customer_data: { name: "Promoter A" } },
          { _id: "s3", rating: "-5", customer_data: { name: "Detractor B" } },
        ],
        total: 3,
      });

      const result = await surveysHandler.handleCall("crewhu_surveys_detractors", { limit: 1 });

      // Always fetches a full page (100) to filter from, regardless of the requested limit.
      expect(mockClient.surveys.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
      const body = text(result);
      expect(body).toContain("Detractor A");
      expect(body).not.toContain("Detractor B");
      expect(body).not.toContain("Promoter A");
    });

    it("defaults since to roughly the last 30 days when not provided", async () => {
      mockClient.surveys.list.mockResolvedValue({ items: [], total: 0 });

      await surveysHandler.handleCall("crewhu_surveys_detractors", {});

      const call = mockClient.surveys.list.mock.calls[0]![0] as { _updated_at: { $gte: string } };
      const sinceMs = new Date(call._updated_at.$gte).getTime();
      const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
    });
  });

  describe("crewhu_surveys_promoters", () => {
    it("filters to positive sentiment only", async () => {
      mockClient.surveys.list.mockResolvedValue({
        items: [
          { _id: "s1", rating: "5", customer_data: { name: "Promoter A" } },
          { _id: "s2", rating: "0", customer_data: { name: "Neutral A" } },
        ],
        total: 2,
      });

      const result = await surveysHandler.handleCall("crewhu_surveys_promoters", {});

      const body = text(result);
      expect(body).toContain("Promoter A");
      expect(body).not.toContain("Neutral A");
    });
  });

  describe("unknown tool", () => {
    it("returns an isError result naming the tool", async () => {
      const result = await surveysHandler.handleCall("crewhu_surveys_nonexistent", {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Unknown surveys tool");
    });
  });

  describe("error handling", () => {
    it("wraps a thrown API error via formatApiError and marks isError", async () => {
      mockClient.surveys.get.mockRejectedValue(new Error("boom"));

      const result = await surveysHandler.handleCall("crewhu_surveys_get", { id: "s1" });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("boom");
    });
  });
});
