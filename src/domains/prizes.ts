import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import type { PrizeHistory } from "@wyre-technology/node-crewhu";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

function redemptionLines(redemption: PrizeHistory): string[] {
  const date = redemption.date_redeem
    ? new Date(redemption.date_redeem).toLocaleDateString()
    : "Unknown date";
  const cancelled = redemption.date_cancel
    ? ` (❌ cancelled ${new Date(redemption.date_cancel).toLocaleDateString()})`
    : "";
  const quantity = redemption.quantity && redemption.quantity > 1 ? ` x${redemption.quantity}` : "";
  return [
    `🎁 **Prize ${redemption.prize || "Unknown"}**${quantity} - ${date}${cancelled}`,
    `User: ${redemption.user || "Unknown"}`,
    `Status: ${redemption.status || "Unknown"}`,
    redemption.points ? `Cost: ${redemption.points} points` : "",
    ""
  ].filter(line => line !== "");
}

const TOOLS: Tool[] = [
  {
    name: "crewhu_prizes_list",
    description: "List prizes in the reward catalog (the prize title is its description; prizes have no separate name field)",
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
        available_only: {
          type: "boolean",
          description: "Show only active prizes (default: true)"
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
          description: "Prize ID (_id)"
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
          description: "Results per page (default: 20, API max: 100)",
          minimum: 1,
          maximum: 100
        },
        step: {
          type: "number",
          description: "Page number, 1-based (default: 1)",
          minimum: 1
        },
        user_id: {
          type: "string",
          description: "Filter by redeeming user ID"
        },
        prize_id: {
          type: "string",
          description: "Filter by specific prize ID"
        },
        status: {
          type: "string",
          description: "Filter by redemption status (exact match; status values are account-specific)"
        },
        since: {
          type: "string",
          description: "Return redemptions updated since this date (ISO string)"
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
          description: "Maximum number of results (default: 20, max: 100)",
          minimum: 1,
          maximum: 100
        }
      },
      required: ["user_id"]
    }
  },
  {
    name: "crewhu_prizes_pending_redemptions",
    description: "Get pending prize redemptions for processing (statuses containing 'pend' are matched client-side within the fetched page)",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50, max: 100)",
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
        const limit = typeof args.limit === "number" ? args.limit : 50;
        const step = typeof args.step === "number" ? args.step : 1;
        const params = { limit, step };

        const response = availableOnly
          ? await client.prizes.getAvailable(params)
          : await client.prizes.list(params);

        const summary = [
          `🎁 **Prize Catalog** (${response.items.length} shown, ${response.total} total${availableOnly ? ", active only" : ""})`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No prizes found in the catalog.");
        } else {
          for (const prize of response.items) {
            summary.push(
              `**${prize.description || "Unnamed prize"}**`,
              `Cost: ${prize.points ? `${prize.points} points` : "Free"}${prize.taxable ? " (taxable)" : ""}`,
              prize.prizeURL ? `URL: ${prize.prizeURL}` : "",
              ""
            );
          }
          if (response.hasMore) {
            summary.push(`📄 More results available. Use step=${response.nextStep} for the next page.`);
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n").replace(/\n{3,}/g, "\n\n") }]
        };
      }

      case "crewhu_prizes_get": {
        const id = args.id as string;
        const prize = await client.prizes.get(id);

        const details = [
          `🎁 **Prize Details** - ID: ${prize._id}`,
          "",
          `**Description:** ${prize.description || "No description"}`,
          `**Cost:** ${prize.points ? `${prize.points} points` : "Free"}`,
          `**Taxable:** ${prize.taxable ? "Yes" : "No"}`,
          `**URL:** ${prize.prizeURL || "None"}`,
          `**Image:** ${prize.image || "None"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_prizes_history_list": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const step = typeof args.step === "number" ? args.step : 1;

        const response = await client.prizeHistory.list({
          limit,
          step,
          ...(args.user_id ? { user: args.user_id as string } : {}),
          ...(args.prize_id ? { prize: args.prize_id as string } : {}),
          ...(args.status ? { status: args.status as string } : {}),
          ...(args.since ? { _updated_at: { $gte: args.since as string } } : {})
        });

        const summary = [
          `📋 **Prize Redemption History** (${response.items.length} shown, ${response.total} total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No prize redemptions found.");
        } else {
          for (const redemption of response.items) {
            summary.push(...redemptionLines(redemption));
          }
          if (response.hasMore) {
            summary.push(`📄 More results available. Use step=${response.nextStep} for the next page.`);
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
          const active = response.items.filter(r => !r.date_cancel);
          const totalPoints = active.reduce((sum, r) => sum + (r.points || 0) * (r.quantity || 1), 0);
          summary.unshift(`**Total Points Spent (active redemptions):** ${totalPoints}`, "");
          for (const redemption of response.items) {
            summary.push(...redemptionLines(redemption));
          }
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
            summary.push(...redemptionLines(redemption));
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
