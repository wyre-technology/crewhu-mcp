/**
 * Real handler-invocation coverage for the prizes domain: mocks the
 * underlying CrewhuClient and exercises prizesHandler.handleCall directly,
 * asserting outbound call shape and response transformation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    prizes: {
      list: vi.fn(),
      get: vi.fn(),
      getAvailable: vi.fn(),
    },
    prizeHistory: {
      list: vi.fn(),
      getByUser: vi.fn(),
      getPending: vi.fn(),
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

import { prizesHandler } from "./prizes.js";

function text(result: Awaited<ReturnType<typeof prizesHandler.handleCall>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

describe("prizesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tools", () => {
    it("exports the expected prize tool names", () => {
      expect(prizesHandler.tools.map((t) => t.name)).toEqual([
        "crewhu_prizes_list",
        "crewhu_prizes_get",
        "crewhu_prizes_history_list",
        "crewhu_prizes_user_redemptions",
        "crewhu_prizes_pending_redemptions",
      ]);
    });

    it("requires id on crewhu_prizes_get and user_id on crewhu_prizes_user_redemptions", () => {
      const get = prizesHandler.tools.find((t) => t.name === "crewhu_prizes_get");
      const redemptions = prizesHandler.tools.find((t) => t.name === "crewhu_prizes_user_redemptions");
      expect(get?.inputSchema.required).toEqual(["id"]);
      expect(redemptions?.inputSchema.required).toEqual(["user_id"]);
    });
  });

  describe("crewhu_prizes_list", () => {
    it("defaults to available-only and calls getAvailable", async () => {
      mockClient.prizes.getAvailable.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await prizesHandler.handleCall("crewhu_prizes_list", {});

      expect(mockClient.prizes.getAvailable).toHaveBeenCalledWith({ limit: 50, step: 1 });
      expect(mockClient.prizes.list).not.toHaveBeenCalled();
    });

    it("calls list (not getAvailable) when available_only is explicitly false", async () => {
      mockClient.prizes.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await prizesHandler.handleCall("crewhu_prizes_list", { available_only: false, limit: 10, step: 3 });

      expect(mockClient.prizes.list).toHaveBeenCalledWith({ limit: 10, step: 3 });
      expect(mockClient.prizes.getAvailable).not.toHaveBeenCalled();
    });

    it("formats prize description, points cost, and taxable flag", async () => {
      mockClient.prizes.getAvailable.mockResolvedValue({
        items: [{ _id: "p1", description: "Gift Card", points: 500, taxable: true, prizeURL: "https://x" }],
        total: 1,
        hasMore: false,
      });

      const body = text(await prizesHandler.handleCall("crewhu_prizes_list", {}));

      expect(body).toContain("Gift Card");
      expect(body).toContain("500 points");
      expect(body).toContain("(taxable)");
      expect(body).toContain("https://x");
    });

    it("treats a free (no points) prize as Free rather than 0 points", async () => {
      mockClient.prizes.getAvailable.mockResolvedValue({
        items: [{ _id: "p1", description: "Free Coffee" }],
        total: 1,
        hasMore: false,
      });

      const body = text(await prizesHandler.handleCall("crewhu_prizes_list", {}));

      expect(body).toContain("Cost: Free");
    });
  });

  describe("crewhu_prizes_get", () => {
    it("fetches a prize by id and formats its details", async () => {
      mockClient.prizes.get.mockResolvedValue({
        _id: "p1",
        description: "Gift Card",
        points: 500,
        taxable: false,
        prizeURL: "https://x",
        image: "img.png",
      });

      const result = await prizesHandler.handleCall("crewhu_prizes_get", { id: "p1" });

      expect(mockClient.prizes.get).toHaveBeenCalledWith("p1");
      const body = text(result);
      expect(body).toContain("ID: p1");
      expect(body).toContain("Gift Card");
      expect(body).toContain("**Taxable:** No");
    });
  });

  describe("crewhu_prizes_history_list", () => {
    it("maps all filters onto their distinct API params", async () => {
      mockClient.prizeHistory.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await prizesHandler.handleCall("crewhu_prizes_history_list", {
        user_id: "u1",
        prize_id: "p1",
        status: "shipped",
        since: "2026-01-01T00:00:00Z",
      });

      expect(mockClient.prizeHistory.list).toHaveBeenCalledWith({
        limit: 20,
        step: 1,
        user: "u1",
        prize: "p1",
        status: "shipped",
        _updated_at: { $gte: "2026-01-01T00:00:00Z" },
      });
    });

    it("omits filter keys entirely when not provided", async () => {
      mockClient.prizeHistory.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await prizesHandler.handleCall("crewhu_prizes_history_list", {});

      expect(mockClient.prizeHistory.list).toHaveBeenCalledWith({ limit: 20, step: 1 });
    });
  });

  describe("crewhu_prizes_user_redemptions", () => {
    it("totals points*quantity from active (non-cancelled) redemptions only", async () => {
      mockClient.prizeHistory.getByUser.mockResolvedValue({
        items: [
          { prize: "p1", user: "u1", points: 100, quantity: 2 },
          { prize: "p2", user: "u1", points: 50, quantity: 1, date_cancel: "2026-01-02T00:00:00Z" },
        ],
        total: 2,
      });

      const result = await prizesHandler.handleCall("crewhu_prizes_user_redemptions", { user_id: "u1" });

      expect(mockClient.prizeHistory.getByUser).toHaveBeenCalledWith("u1", { limit: 20 });
      expect(text(result)).toContain("Total Points Spent (active redemptions):** 200");
    });
  });

  describe("crewhu_prizes_pending_redemptions", () => {
    it("calls getPending with the default limit and formats a caught-up message when empty", async () => {
      mockClient.prizeHistory.getPending.mockResolvedValue({ items: [], total: 0 });

      const result = await prizesHandler.handleCall("crewhu_prizes_pending_redemptions", {});

      expect(mockClient.prizeHistory.getPending).toHaveBeenCalledWith({ limit: 50 });
      expect(text(result)).toContain("All caught up!");
    });

    it("passes an explicit limit through and lists pending entries", async () => {
      mockClient.prizeHistory.getPending.mockResolvedValue({
        items: [{ prize: "p1", user: "u1", status: "pending" }],
        total: 1,
      });

      const result = await prizesHandler.handleCall("crewhu_prizes_pending_redemptions", { limit: 5 });

      expect(mockClient.prizeHistory.getPending).toHaveBeenCalledWith({ limit: 5 });
      expect(text(result)).toContain("manual processing");
    });
  });

  describe("unknown tool", () => {
    it("returns an isError result naming the tool", async () => {
      const result = await prizesHandler.handleCall("crewhu_prizes_nonexistent", {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Unknown prizes tool");
    });
  });

  describe("error handling", () => {
    it("wraps a thrown API error via formatApiError and marks isError", async () => {
      mockClient.prizes.get.mockRejectedValue(Object.assign(new Error("Rate limited"), { statusCode: 429 }));

      const result = await prizesHandler.handleCall("crewhu_prizes_get", { id: "p1" });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Rate limited (HTTP 429)");
    });
  });
});
