import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

const TOOLS: Tool[] = [
  {
    name: "crewhu_users_list",
    description: "List employees/users with optional filtering and pagination",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50, max: 1000)",
          minimum: 1,
          maximum: 1000
        },
        step: {
          type: "number",
          description: "Pagination offset",
          minimum: 0
        },
        department: {
          type: "string",
          description: "Filter by department name"
        },
        role: {
          type: "string",
          description: "Filter by user role"
        },
        active: {
          type: "boolean",
          description: "Filter by active status (default: true)"
        }
      }
    }
  },
  {
    name: "crewhu_users_get",
    description: "Get a specific user by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "User ID"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_users_search",
    description: "Search users by name or email",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (name or email)"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        }
      },
      required: ["query"]
    }
  }
];

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getClient();

    switch (name) {
      case "crewhu_users_list": {
        const params: Record<string, unknown> = {
          limit: typeof args.limit === "number" ? args.limit : 50,
          step: typeof args.step === "number" ? args.step : 0
        };
        if (args.department) params.department = args.department;
        if (args.role) params.role = args.role;
        if (args.active !== undefined) params.active = args.active;

        const response = await client.users.list(params);
        const summary = [
          `👥 **Users/Employees** (${response.items.length} of ${response.step + response.items.length}+ total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No users found matching the criteria.");
        } else {
          for (const user of response.items) {
            const status = user.active ? "✅ Active" : "❌ Inactive";
            const department = user.department || "Unknown dept";
            const role = user.role || "Unknown role";
            summary.push(
              `**${user.name || "Unknown name"}** (${user.email || "no email"})`,
              `${role} - ${department} - ${status}`,
              ""
            );
          }
          if (response.hasMore) {
            summary.push(`📄 More results available. Use step=${response.nextStep} for next page.`);
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_users_get": {
        const id = args.id as string;
        const user = await client.users.get(id);
        const details = [
          `👤 **User Details** - ID: ${user.id}`,
          "",
          `**Name:** ${user.name || "Unknown"}`,
          `**Email:** ${user.email || "No email"}`,
          `**Role:** ${user.role || "Unknown role"}`,
          `**Department:** ${user.department || "Unknown department"}`,
          `**Status:** ${user.active ? "✅ Active" : "❌ Inactive"}`,
          `**Created:** ${user.created_at ? new Date(user.created_at).toLocaleString() : "Unknown"}`,
          `**Last Updated:** ${user.updated_at ? new Date(user.updated_at).toLocaleString() : "Unknown"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_users_search": {
        const query = args.query as string;
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const response = await client.users.search(query, { limit });
        const summary = [
          `🔍 **User Search Results for "${query}"** (${response.items.length} found)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No users found matching your search query.");
        } else {
          for (const user of response.items) {
            const status = user.active ? "✅ Active" : "❌ Inactive";
            const department = user.department || "Unknown dept";
            const role = user.role || "Unknown role";
            summary.push(
              `**${user.name || "Unknown name"}** (${user.email || "no email"})`,
              `${role} - ${department} - ${status}`,
              ""
            );
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      default:
        return {
          content: [{ type: "text", text: `❌ Unknown users tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    logger.error("Users tool error", { toolName: name, error });
    return {
      content: [{
        type: "text",
        text: `❌ Error in ${name}: ${formatApiError(error)}`
      }],
      isError: true
    };
  }
}

export const usersHandler: DomainHandler = { tools: TOOLS, handleCall };