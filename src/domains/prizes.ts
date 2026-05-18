import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

const TOOLS: Tool[] = [
  {
    name: "crewhu_prizes_list",
    description: "List available prizes in the reward catalog",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50)",
          minimum: 1,
          maximum: 1000
        },
        category: {
          type: "string",
          description: "Filter by prize category"
        },
        available_only: {
          type: "boolean",
          description: "Show only available prizes (default: true)"
        }
      }
    }
  },
  {
    name: "crewhu_prizes_get",
    description: "Get details of a specific prize",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Prize ID"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_prizes_history_list",
    description: "List prize redemption history",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        },
        user_id: {
          type: "string",
          description: "Filter by specific user ID"
        },
        prize_id: {
          type: "string",
          description: "Filter by specific prize ID"
        },
        status: {
          type: "string",
          enum: ["pending", "fulfilled", "redeemed", "cancelled"],
          description: "Filter by redemption status"
        },
        since: {
          type: "string",
          description: "Return redemptions since this date (ISO string)"
        }
      }
    }
  },
  {
    name: "crewhu_prizes_user_redemptions",
    description: "Get prize redemption history for a specific user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID to get redemptions for"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        }
      },
      required: ["user_id"]
    }
  },
  {
    name: "crewhu_prizes_pending_redemptions",
    description: "Get all pending prize redemptions for processing",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50)",
          minimum: 1,
          maximum: 100
        }
      }
    }
  }
];

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getClient();

    switch (name) {
      case "crewhu_prizes_list": {
        const availableOnly = args.available_only !== false;
        const params: Record<string, unknown> = {
          limit: typeof args.limit === "number" ? args.limit : 50
        };
        if (args.category) params.category = args.category;
        if (availableOnly) params.available = true;

        const response = availableOnly
          ? await client.prizes.getAvailable(params)
          : await client.prizes.list(params);

        const summary = [
          `🎁 **Prize Catalog** (${response.items.length} ${availableOnly ? "available " : ""}prizes)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No prizes found in the catalog.");
        } else {
          for (const prize of response.items) {
            const cost = prize.cost ? `${prize.cost} points` : "Free";
            const category = prize.category || "Uncategorized";
            const availability = prize.available ? "✅ Available" : "❌ Not Available";

            summary.push(
              `**${prize.name || "Unknown prize"}** (${category})`,
              prize.description || "No description",
              `Cost: ${cost} - ${availability}`,
              ""
            );
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_prizes_get": {
        const id = args.id as string;
        const prize = await client.prizes.get(id);

        const details = [
          `🎁 **Prize Details** - ID: ${prize.id}`,
          "",
          `**Name:** ${prize.name || "Unknown"}`,
          `**Category:** ${prize.category || "Uncategorized"}`,
          `**Description:** ${prize.description || "No description"}`,
          `**Cost:** ${prize.cost ? `${prize.cost} points` : "Free"}`,
          `**Available:** ${prize.available ? "✅ Yes" : "❌ No"}`,
          `**Created:** ${prize.created_at ? new Date(prize.created_at).toLocaleString() : "Unknown"}`,
          `**Last Updated:** ${prize.updated_at ? new Date(prize.updated_at).toLocaleString() : "Unknown"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_prizes_history_list": {
        const params: Record<string, unknown> = {
          limit: typeof args.limit === "number" ? args.limit : 20
        };
        if (args.user_id) params.user_id = args.user_id;
        if (args.prize_id) params.prize_id = args.prize_id;
        if (args.status) params.status = args.status;
        if (args.since) {
          params._updated_at = { $gte: args.since };
        }

        const response = await client.prizeHistory.list(params);

        const summary = [
          `📋 **Prize Redemption History** (${response.items.length} redemptions)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No prize redemptions found.");
        } else {
          for (const redemption of response.items) {
            const date = redemption.created_at ? new Date(redemption.created_at).toLocaleDateString() : "Unknown";
            const redeemedDate = redemption.redeemed_at ? new Date(redemption.redeemed_at).toLocaleDateString() : "Not redeemed";
            const status = redemption.status || "Unknown";
            const cost = redemption.cost ? `${redemption.cost} points` : "Free";

            summary.push(
              `🎁 **Prize Redemption** - ${date}`,
              `User: ${redemption.user_id || "Unknown"}`,
              `Prize: ${redemption.prize_id || "Unknown"}`,
              `Status: ${status}`,
              `Cost: ${cost}`,
              `Redeemed: ${redeemedDate}`,
              ""
            );
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_prizes_user_redemptions": {
        const userId = args.user_id as string;
        const limit = typeof args.limit === "number" ? args.limit : 20;

        const response = await client.prizeHistory.getByUser(userId, { limit });

        const summary = [
          `🎁 **Prize Redemptions for User ${userId}** (${response.items.length} redemptions)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No prize redemptions found for this user.");
        } else {
          let totalCost = 0;
          for (const redemption of response.items) {
            const date = redemption.created_at ? new Date(redemption.created_at).toLocaleDateString() : "Unknown";
            const cost = redemption.cost || 0;
            totalCost += cost;
            const status = redemption.status || "Unknown";

            summary.push(
              `🎁 ${redemption.prize_id || "Unknown prize"} - ${date}`,
              `Status: ${status}`,
              cost > 0 ? `Cost: ${cost} points` : "Free",
              ""
            );
          }
          summary.unshift(`**Total Points Spent:** ${totalCost}`, "");
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_prizes_pending_redemptions": {
        const limit = typeof args.limit === "number" ? args.limit : 50;

        const response = await client.prizeHistory.getPending({ limit });

        const summary = [
          `⏳ **Pending Prize Redemptions** (${response.items.length} pending)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("✅ No pending prize redemptions. All caught up!");
        } else {
          for (const redemption of response.items) {
            const date = redemption.created_at ? new Date(redemption.created_at).toLocaleDateString() : "Unknown";
            const cost = redemption.cost ? `${redemption.cost} points` : "Free";

            summary.push(
              `⏳ **Pending** - ${date}`,
              `User: ${redemption.user_id || "Unknown"}`,
              `Prize: ${redemption.prize_id || "Unknown"}`,
              `Cost: ${cost}`,
              ""
            );
          }
          summary.push("💡 These redemptions require manual processing or fulfillment.");
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      default:
        return {
          content: [{ type: "text", text: `❌ Unknown prizes tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    logger.error("Prizes tool error", { toolName: name, error });
    const errorMessage = formatApiError(error);
    return {
      content: [{
        type: "text",
        text: `❌ Error in ${name}: ${errorMessage}`
      }],
      isError: true
    };
  }
}

export const prizesHandler: DomainHandler = { tools: TOOLS, handleCall };