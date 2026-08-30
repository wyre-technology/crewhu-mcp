/**
 * Real handler-invocation coverage for the badges domain: mocks the
 * underlying CrewhuClient and exercises badgesHandler.handleCall directly,
 * asserting outbound call shape (what we ask the API for) and response
 * transformation (what we hand back to the model).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    badges: {
      list: vi.fn(),
      get: vi.fn(),
      updateContestTarget: vi.fn(),
    },
    badgeHistory: {
      list: vi.fn(),
      getByUser: vi.fn(),
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

import { badgesHandler } from "./badges.js";

function text(result: Awaited<ReturnType<typeof badgesHandler.handleCall>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

describe("badgesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tools", () => {
    it("exports the expected badge tool names", () => {
      expect(badgesHandler.tools.map((t) => t.name)).toEqual([
        "crewhu_badges_list",
        "crewhu_badges_get",
        "crewhu_badges_history_list",
        "crewhu_badges_user_recognition",
        "crewhu_badges_update_contest",
      ]);
    });

    it("requires id on crewhu_badges_get and crewhu_badges_update_contest", () => {
      const get = badgesHandler.tools.find((t) => t.name === "crewhu_badges_get");
      const update = badgesHandler.tools.find((t) => t.name === "crewhu_badges_update_contest");
      expect(get?.inputSchema.required).toEqual(["id"]);
      expect(update?.inputSchema.required).toEqual(["id"]);
    });

    it("requires user_id on crewhu_badges_user_recognition", () => {
      const tool = badgesHandler.tools.find((t) => t.name === "crewhu_badges_user_recognition");
      expect(tool?.inputSchema.required).toEqual(["user_id"]);
    });
  });

  describe("crewhu_badges_list", () => {
    it("defaults limit/step and formats an empty result", async () => {
      mockClient.badges.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      const result = await badgesHandler.handleCall("crewhu_badges_list", {});

      expect(mockClient.badges.list).toHaveBeenCalledWith({ limit: 50, step: 1 });
      expect(text(result)).toContain("No badges found.");
      expect(result.isError).toBeUndefined();
    });

    it("passes explicit limit/step through and lists badge names", async () => {
      mockClient.badges.list.mockResolvedValue({
        items: [{ _id: "b1", name: "Team Player", description: "Great teamwork" }],
        total: 1,
        hasMore: false,
      });

      const result = await badgesHandler.handleCall("crewhu_badges_list", { limit: 10, step: 2 });

      expect(mockClient.badges.list).toHaveBeenCalledWith({ limit: 10, step: 2 });
      const body = text(result);
      expect(body).toContain("Team Player");
      expect(body).toContain("Great teamwork");
    });

    it("surfaces a next-page hint when hasMore is true", async () => {
      mockClient.badges.list.mockResolvedValue({
        items: [{ _id: "b1", name: "X" }],
        total: 5,
        hasMore: true,
        nextStep: 2,
      });

      const result = await badgesHandler.handleCall("crewhu_badges_list", {});

      expect(text(result)).toContain("step=2");
    });
  });

  describe("crewhu_badges_get", () => {
    it("fetches a badge by id and formats its details", async () => {
      mockClient.badges.get.mockResolvedValue({
        _id: "b1",
        name: "Team Player",
        description: "Great teamwork",
        imageFile: "team.png",
      });

      const result = await badgesHandler.handleCall("crewhu_badges_get", { id: "b1" });

      expect(mockClient.badges.get).toHaveBeenCalledWith("b1");
      const body = text(result);
      expect(body).toContain("ID: b1");
      expect(body).toContain("Team Player");
      expect(body).toContain("team.png");
    });
  });

  describe("crewhu_badges_history_list", () => {
    it("maps all filters onto their distinct API params", async () => {
      mockClient.badgeHistory.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await badgesHandler.handleCall("crewhu_badges_history_list", {
        user_id: "u1",
        badge_id: "b1",
        awarded_by: "u2",
        since: "2026-01-01T00:00:00Z",
      });

      expect(mockClient.badgeHistory.list).toHaveBeenCalledWith({
        limit: 20,
        step: 1,
        toUser: "u1",
        badge: "b1",
        extraQuery: { fromUser: "u2" },
        _updated_at: { $gte: "2026-01-01T00:00:00Z" },
      });
    });

    it("omits filter keys entirely when not provided", async () => {
      mockClient.badgeHistory.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await badgesHandler.handleCall("crewhu_badges_history_list", {});

      expect(mockClient.badgeHistory.list).toHaveBeenCalledWith({ limit: 20, step: 1 });
    });

    it("renders award lines including cancellation and points", async () => {
      mockClient.badgeHistory.list.mockResolvedValue({
        items: [
          {
            badge: "Team Player",
            fromUser: "Alice",
            toUsers: ["Bob"],
            dateGiven: "2026-01-01T00:00:00Z",
            dateCancelled: "2026-01-02T00:00:00Z",
            message: "Nice work",
            badgePoints: 10,
          },
        ],
        total: 1,
        hasMore: false,
      });

      const body = text(await badgesHandler.handleCall("crewhu_badges_history_list", {}));

      expect(body).toContain("Team Player");
      expect(body).toContain("cancelled");
      expect(body).toContain("Alice");
      expect(body).toContain("Bob");
      expect(body).toContain("Nice work");
      expect(body).toContain("+10 points");
    });
  });

  describe("crewhu_badges_user_recognition", () => {
    it("fetches recognition for a user and totals points from active awards only", async () => {
      mockClient.badgeHistory.getByUser.mockResolvedValue({
        items: [
          { badge: "b1", toUsers: ["u1"], badgePoints: 10 },
          { badge: "b2", toUsers: ["u1"], badgePoints: 5, dateCancelled: "2026-01-02T00:00:00Z" },
        ],
        total: 2,
      });

      const result = await badgesHandler.handleCall("crewhu_badges_user_recognition", { user_id: "u1" });

      expect(mockClient.badgeHistory.getByUser).toHaveBeenCalledWith("u1", { limit: 20 });
      const body = text(result);
      expect(body).toContain("Total Points from Active Awards:** 10");
    });

    it("uses the provided limit", async () => {
      mockClient.badgeHistory.getByUser.mockResolvedValue({ items: [], total: 0 });

      await badgesHandler.handleCall("crewhu_badges_user_recognition", { user_id: "u1", limit: 5 });

      expect(mockClient.badgeHistory.getByUser).toHaveBeenCalledWith("u1", { limit: 5 });
    });
  });

  describe("crewhu_badges_update_contest", () => {
    it("sends only the id when no optional fields are provided", async () => {
      mockClient.badges.updateContestTarget.mockResolvedValue({ _id: "c1" });

      await badgesHandler.handleCall("crewhu_badges_update_contest", { id: "c1" });

      expect(mockClient.badges.updateContestTarget).toHaveBeenCalledWith({ id: "c1" });
    });

    it("includes target/name/description when provided", async () => {
      mockClient.badges.updateContestTarget.mockResolvedValue({ _id: "c1" });

      await badgesHandler.handleCall("crewhu_badges_update_contest", {
        id: "c1",
        target: 100,
        name: "Q3 Push",
        description: "Sprint to the finish",
      });

      expect(mockClient.badges.updateContestTarget).toHaveBeenCalledWith({
        id: "c1",
        target: 100,
        name: "Q3 Push",
        description: "Sprint to the finish",
      });
    });

    it("formats the updated contest details in the response", async () => {
      mockClient.badges.updateContestTarget.mockResolvedValue({
        _id: "c1",
        name: "Q3 Push",
        description: "Sprint to the finish",
        target: 100,
        current: 42,
        active: true,
      });

      const body = text(await badgesHandler.handleCall("crewhu_badges_update_contest", { id: "c1" }));

      expect(body).toContain("Contest Updated Successfully");
      expect(body).toContain("Q3 Push");
      expect(body).toContain("**Target:** 100");
      expect(body).toContain("**Current Progress:** 42");
      expect(body).toContain("**Active:** Yes");
    });
  });

  describe("unknown tool", () => {
    it("returns an isError result naming the tool", async () => {
      const result = await badgesHandler.handleCall("crewhu_badges_nonexistent", {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Unknown badges tool");
    });
  });

  describe("error handling", () => {
    it("wraps a thrown API error via formatApiError and marks isError", async () => {
      mockClient.badges.get.mockRejectedValue(Object.assign(new Error("Not Found"), { statusCode: 404 }));

      const result = await badgesHandler.handleCall("crewhu_badges_get", { id: "missing" });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Not Found (HTTP 404)");
    });
  });
});
