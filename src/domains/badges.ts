import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import type { BadgeHistory } from "@wyre-technology/node-crewhu";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

function awardLines(award: BadgeHistory): string[] {
  const date = award.dateGiven ? new Date(award.dateGiven).toLocaleDateString() : "Unknown date";
  const cancelled = award.dateCancelled
    ? ` (❌ cancelled ${new Date(award.dateCancelled).toLocaleDateString()})`
    : "";
  return [
    `🏆 **Badge ${award.badge || "Unknown"}** - ${date}${cancelled}`,
    `From: ${award.fromUser || "System"} → To: ${award.toUsers?.join(", ") || "Unknown"}`,
    award.message ? `"${award.message}"` : "",
    award.badgePoints ? `+${award.badgePoints} points` : "",
    ""
  ].filter(line => line !== "");
}

const TOOLS: Tool[] = [
  {
    name: "crewhu_badges_list",
    description: "List available badges and recognition elements",
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
        }
      }
    }
  },
  {
    name: "crewhu_badges_get",
    description: "Get details of a specific badge",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Badge ID (_id)"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_badges_history_list",
    description: "List badge award history (peer recognition feed)",
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
          description: "Filter by recipient user ID"
        },
        badge_id: {
          type: "string",
          description: "Filter by specific badge ID"
        },
        awarded_by: {
          type: "string",
          description: "Filter by the giver's user ID"
        },
        since: {
          type: "string",
          description: "Return awards updated since this date (ISO string)"
        }
      }
    }
  },
  {
    name: "crewhu_badges_user_recognition",
    description: "Get all badge awards/recognition for a specific user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "User ID to get recognition for"
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
    name: "crewhu_badges_update_contest",
    description: "Update contest target or settings (write operation)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Contest/badge ID to update"
        },
        target: {
          type: "number",
          description: "New target value for the contest",
          minimum: 0
        },
        name: {
          type: "string",
          description: "Contest name"
        },
        description: {
          type: "string",
          description: "Contest description"
        }
      },
      required: ["id"]
    }
  }
];

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getClient();

    switch (name) {
      case "crewhu_badges_list": {
        const limit = typeof args.limit === "number" ? args.limit : 50;
        const step = typeof args.step === "number" ? args.step : 1;

        const response = await client.badges.list({ limit, step });
        const summary = [
          `🏆 **Available Badges** (${response.items.length} shown, ${response.total} total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No badges found.");
        } else {
          for (const badge of response.items) {
            summary.push(
              `**${badge.name || "Unknown badge"}**`,
              badge.description || "No description",
              ""
            );
          }
          if (response.hasMore) {
            summary.push(`📄 More results available. Use step=${response.nextStep} for the next page.`);
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_badges_get": {
        const id = args.id as string;
        const badge = await client.badges.get(id);
        const details = [
          `🏆 **Badge Details** - ID: ${badge._id}`,
          "",
          `**Name:** ${badge.name || "Unknown"}`,
          `**Description:** ${badge.description || "No description"}`,
          `**Image:** ${badge.imageFile || badge.imageClass || "None"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_badges_history_list": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const step = typeof args.step === "number" ? args.step : 1;

        const response = await client.badgeHistory.list({
          limit,
          step,
          ...(args.user_id ? { toUser: args.user_id as string } : {}),
          ...(args.badge_id ? { badge: args.badge_id as string } : {}),
          ...(args.awarded_by ? { extraQuery: { fromUser: args.awarded_by } } : {}),
          ...(args.since ? { _updated_at: { $gte: args.since as string } } : {})
        });

        const summary = [
          `🏅️ **Badge Award History** (${response.items.length} shown, ${response.total} total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No badge awards found.");
        } else {
          for (const award of response.items) {
            summary.push(...awardLines(award));
          }
          if (response.hasMore) {
            summary.push(`📄 More awards available. Use step=${response.nextStep} for the next page.`);
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_badges_user_recognition": {
        const userId = args.user_id as string;
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const response = await client.badgeHistory.getByUser(userId, { limit });

        const summary = [
          `🌟 **Recognition for User ${userId}** (${response.items.length} awards)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No recognition awards found for this user.");
        } else {
          const active = response.items.filter(a => !a.dateCancelled);
          const totalPoints = active.reduce((sum, a) => sum + (a.badgePoints || 0), 0);
          summary.unshift(`**Total Points from Active Awards:** ${totalPoints}`, "");
          for (const award of response.items) {
            summary.push(...awardLines(award));
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_badges_update_contest": {
        const id = args.id as string;
        const target = args.target as number | undefined;
        const name = args.name as string | undefined;
        const description = args.description as string | undefined;

        const updateData: { id: string; target?: number; name?: string; description?: string } = { id };
        if (target !== undefined) updateData.target = target;
        if (name) updateData.name = name;
        if (description) updateData.description = description;

        const contest = await client.badges.updateContestTarget(updateData);
        const details = [
          `✅ **Contest Updated Successfully**`,
          "",
          `**ID:** ${contest._id || id}`,
          `**Name:** ${contest.name || "Unnamed contest"}`,
          `**Description:** ${contest.description || "No description"}`,
          `**Target:** ${contest.target ?? 0}`,
          `**Current Progress:** ${contest.current ?? 0}`,
          `**Active:** ${contest.active ? "Yes" : "No"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      default:
        return {
          content: [{ type: "text", text: `❌ Unknown badges tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    logger.error("Badges tool error", { toolName: name, error });
    return {
      content: [{
        type: "text",
        text: `❌ Error in ${name}: ${formatApiError(error)}`
      }],
      isError: true
    };
  }
}

export const badgesHandler: DomainHandler = { tools: TOOLS, handleCall };
