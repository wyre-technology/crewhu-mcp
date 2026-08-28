/**
 * Real handler-invocation coverage for the users domain: mocks the
 * underlying CrewhuClient and exercises usersHandler.handleCall directly,
 * asserting outbound call shape and response transformation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    users: {
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

import { usersHandler } from "./users.js";

function text(result: Awaited<ReturnType<typeof usersHandler.handleCall>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

describe("usersHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tools", () => {
    it("exports the expected user tool names", () => {
      expect(usersHandler.tools.map((t) => t.name)).toEqual([
        "crewhu_users_list",
        "crewhu_users_get",
        "crewhu_users_search",
      ]);
    });

    it("requires id on crewhu_users_get and query on crewhu_users_search", () => {
      const get = usersHandler.tools.find((t) => t.name === "crewhu_users_get");
      const search = usersHandler.tools.find((t) => t.name === "crewhu_users_search");
      expect(get?.inputSchema.required).toEqual(["id"]);
      expect(search?.inputSchema.required).toEqual(["query"]);
    });
  });

  describe("crewhu_users_list", () => {
    it("defaults to active-only (inactive: false) with no department filter", async () => {
      mockClient.users.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await usersHandler.handleCall("crewhu_users_list", {});

      expect(mockClient.users.list).toHaveBeenCalledWith({ limit: 50, step: 1, inactive: false });
    });

    it("omits the inactive filter when include_inactive is true", async () => {
      mockClient.users.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await usersHandler.handleCall("crewhu_users_list", { include_inactive: true });

      expect(mockClient.users.list).toHaveBeenCalledWith({ limit: 50, step: 1 });
    });

    it("maps department into extraQuery.department", async () => {
      mockClient.users.list.mockResolvedValue({ items: [], total: 0, hasMore: false });

      await usersHandler.handleCall("crewhu_users_list", { department: "Support" });

      expect(mockClient.users.list).toHaveBeenCalledWith({
        limit: 50,
        step: 1,
        inactive: false,
        extraQuery: { department: "Support" },
      });
    });

    it("formats employee name, position, department, and location", async () => {
      mockClient.users.list.mockResolvedValue({
        items: [
          {
            _id: "u1",
            firstname: "Jane",
            lastname: "Doe",
            employee_id: "E-1",
            position: "Engineer",
            department: "Support",
            location: "Remote",
          },
        ],
        total: 1,
        hasMore: false,
      });

      const body = text(await usersHandler.handleCall("crewhu_users_list", {}));

      expect(body).toContain("Jane Doe");
      expect(body).toContain("employee ID: E-1");
      expect(body).toContain("Engineer - Support - Remote");
    });
  });

  describe("crewhu_users_get", () => {
    it("fetches a user by id and formats their details", async () => {
      mockClient.users.get.mockResolvedValue({
        _id: "u1",
        firstname: "Jane",
        lastname: "Doe",
        employee_id: "E-1",
        position: "Engineer",
        department: "Support",
        location: "Remote",
        hiredate: "2026-01-01T00:00:00Z",
        managed_departments: ["Support"],
        managed_locations: ["Remote"],
      });

      const result = await usersHandler.handleCall("crewhu_users_get", { id: "u1" });

      expect(mockClient.users.get).toHaveBeenCalledWith("u1");
      const body = text(result);
      expect(body).toContain("ID: u1");
      expect(body).toContain("Jane Doe");
      expect(body).toContain("**Manages departments:** Support");
      expect(body).toContain("**Manages locations:** Remote");
    });

    it("omits manager lines entirely for a non-manager", async () => {
      mockClient.users.get.mockResolvedValue({ _id: "u1", firstname: "Jane", lastname: "Doe" });

      const body = text(await usersHandler.handleCall("crewhu_users_get", { id: "u1" }));

      expect(body).not.toContain("Manages departments");
      expect(body).not.toContain("Manages locations");
    });
  });

  describe("crewhu_users_search", () => {
    it("passes the query and limit through to client.users.search", async () => {
      mockClient.users.search.mockResolvedValue({ items: [], total: 0 });

      await usersHandler.handleCall("crewhu_users_search", { query: "Jane", limit: 10 });

      expect(mockClient.users.search).toHaveBeenCalledWith("Jane", { limit: 10 });
    });

    it("defaults limit to 100 when not provided", async () => {
      mockClient.users.search.mockResolvedValue({ items: [], total: 0 });

      await usersHandler.handleCall("crewhu_users_search", { query: "Jane" });

      expect(mockClient.users.search).toHaveBeenCalledWith("Jane", { limit: 100 });
    });

    it("formats matched users in the response", async () => {
      mockClient.users.search.mockResolvedValue({
        items: [{ _id: "u1", firstname: "Jane", lastname: "Doe" }],
        total: 1,
      });

      const body = text(await usersHandler.handleCall("crewhu_users_search", { query: "Jane" }));

      expect(body).toContain('Search Results for "Jane"');
      expect(body).toContain("Jane Doe");
    });
  });

  describe("unknown tool", () => {
    it("returns an isError result naming the tool", async () => {
      const result = await usersHandler.handleCall("crewhu_users_nonexistent", {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Unknown users tool");
    });
  });

  describe("error handling", () => {
    it("wraps a thrown API error via formatApiError and marks isError", async () => {
      mockClient.users.get.mockRejectedValue(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));

      const result = await usersHandler.handleCall("crewhu_users_get", { id: "u1" });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Unauthorized (HTTP 401)");
    });
  });
});
