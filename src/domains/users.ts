import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import type { User } from "@wyre-technology/node-crewhu";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

function fullName(user: User): string {
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ");
  return name || "Unknown name";
}

function userLine(user: User): string[] {
  const position = user.position || "Unknown position";
  const department = user.department || "Unknown dept";
  const location = user.location ? ` - ${user.location}` : "";
  return [
    `**${fullName(user)}**${user.employee_id ? ` (employee ID: ${user.employee_id})` : ""}`,
    `${position} - ${department}${location}`,
    ""
  ];
}

const TOOLS: Tool[] = [
  {
    name: "crewhu_users_list",
    description: "List employees/users with optional filtering and pagination",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Results per page (default: 50, API max: 100)",
          minimum: 1,
          maximum: 100
        },
        step: {
          type: "number",
          description: "Page number, 1-based (default: 1)",
          minimum: 1
        },
        department: {
          type: "string",
          description: "Filter by department name (exact match)"
        },
        include_inactive: {
          type: "boolean",
          description: "Include inactive users (default: false, meaning only active)"
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
          description: "User ID (_id)"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_users_search",
    description: "Search users by name, employee ID, department, position, or location (client-side within the fetched page; the API has no search endpoint)",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (name, employee ID, department, position, or location)"
        },
        limit: {
          type: "number",
          description: "Users to fetch and search within (default: 100, API max: 100)",
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
        const limit = typeof args.limit === "number" ? args.limit : 50;
        const step = typeof args.step === "number" ? args.step : 1;

        const response = await client.users.list({
          limit,
          step,
          ...(args.include_inactive ? {} : { inactive: false }),
          ...(args.department ? { extraQuery: { department: args.department } } : {})
        });

        const summary = [
          `👥 **Users/Employees** (${response.items.length} shown, ${response.total} total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No users found matching the criteria.");
        } else {
          for (const user of response.items) {
            summary.push(...userLine(user));
          }
          if (response.hasMore) {
            summary.push(`📄 More results available. Use step=${response.nextStep} for the next page.`);
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
          `👤 **User Details** - ID: ${user._id}`,
          "",
          `**Name:** ${fullName(user)}`,
          `**Employee ID:** ${user.employee_id || "Unknown"}`,
          `**Position:** ${user.position || "Unknown"}`,
          `**Department:** ${user.department || "Unknown"}`,
          `**Location:** ${user.location || "Unknown"}`,
          `**Hired:** ${user.hiredate ? new Date(user.hiredate).toLocaleDateString() : "Unknown"}`,
          user.managed_departments?.length ? `**Manages departments:** ${user.managed_departments.join(", ")}` : "",
          user.managed_locations?.length ? `**Manages locations:** ${user.managed_locations.join(", ")}` : ""
        ].filter(line => line !== "");

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_users_search": {
        const query = args.query as string;
        const limit = typeof args.limit === "number" ? args.limit : 100;
        const response = await client.users.search(query, { limit });
        const summary = [
          `🔍 **User Search Results for "${query}"** (${response.items.length} found)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No users found matching your search query.");
        } else {
          for (const user of response.items) {
            summary.push(...userLine(user));
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
