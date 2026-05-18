import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

const TOOLS: Tool[] = [
  {
    name: "crewhu_badges_list",
    description: "List available badges and recognition elements",
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
          description: "Filter by badge category"
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
          description: "Badge ID"
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
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        },
        step: {
          type: "number",
          description: "Pagination offset",
          minimum: 0
        },
        user_id: {
          type: "string",
          description: "Filter by specific user ID"
        },
        badge_id: {
          type: "string",
          description: "Filter by specific badge ID"
        },
        awarded_by: {
          type: "string",
          description: "Filter by who awarded the badge"
        },
        since: {
          type: "string",
          description: "Return awards since this date (ISO string)"
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
          description: "Maximum number of results (default: 20)",
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
        const params: { limit?: number; category?: string } = {
          limit: typeof args.limit === "number" ? args.limit : 50
        };
        if (args.category) params.category = args.category as string;

        const response = await client.badges.list(params);
        const summary = [
          `🏆 **Available Badges** (${response.items.length} found)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No badges found.");
        } else {
          for (const badge of response.items) {
            const points = badge.points ? `${badge.points} points` : "No points";
            const category = badge.category || "Uncategorized";
            summary.push(
              `**${badge.name || "Unknown badge"}** (${category})`,
              badge.description || "No description",
              `Points: ${points}`,
              ""
            );
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
          `🏆 **Badge Details** - ID: ${badge.id}`,
          "",
          `**Name:** ${badge.name || "Unknown"}`,
          `**Category:** ${badge.category || "Uncategorized"}`,
          `**Description:** ${badge.description || "No description"}`,
          `**Points:** ${badge.points || 0}`,
          `**Icon:** ${badge.icon || "None"}`,
          `**Created:** ${badge.created_at ? new Date(badge.created_at).toLocaleString() : "Unknown"}`
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_badges_history_list": {
        const params: {
          limit?: number;
          step?: number;
          user_id?: string;
          badge_id?: string;
          awarded_by?: string;
          _updated_at?: { $gte?: string };
        } = {
          limit: typeof args.limit === "number" ? args.limit : 20,
          step: typeof args.step === "number" ? args.step : 0
        };

        if (args.user_id) params.user_id = args.user_id as string;
        if (args.badge_id) params.badge_id = args.badge_id as string;
        if (args.awarded_by) params.awarded_by = args.awarded_by as string;
        if (args.since) {
          params._updated_at = { $gte: args.since as string };
        }

        const response = await client.badgeHistory.list(params);
        const summary = [
          `🏅️ **Badge Award History** (${response.items.length} awards)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No badge awards found.");
        } else {
          for (const award of response.items) {
            const date = award.created_at ? new Date(award.created_at).toLocaleDateString() : "Unknown date";
            const points = award.points ? `+${award.points} points` : "";
            summary.push(
              `🏆 **Badge Award** - ${date}`,
              `User: ${award.user_id || "Unknown"}`,
              `Badge: ${award.badge_id || "Unknown"}`,
              `Awarded by: ${award.awarded_by || "System"}`,
              award.reason ? `Reason: "${award.reason}"` : "",
              points,
              ""
            );
          }

          if (response.hasMore) {
            summary.push(`📄 More awards available. Use step=${response.nextStep} for next page.`);
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
          let totalPoints = 0;
          for (const award of response.items) {
            const date = award.created_at ? new Date(award.created_at).toLocaleDateString() : "Unknown";
            const points = award.points || 0;
            totalPoints += points;
            summary.push(
              `🏆 ${award.badge_id || "Unknown badge"} - ${date}`,
              `Awarded by: ${award.awarded_by || "System"}`,
              award.reason ? `"${award.reason}"` : "",
              points > 0 ? `+${points} points` : "",
              ""
            );
          }

          summary.unshift(`**Total Points from Awards:** ${totalPoints}`, "");
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
          `**ID:** ${contest.id}`,
          `**Name:** ${contest.name || "Unnamed contest"}`,
          `**Description:** ${contest.description || "No description"}`,
          `**Target:** ${contest.target || 0}`,
          `**Current Progress:** ${contest.current || 0}`,
          `**Active:** ${contest.active ? "Yes" : "No"}`,
          `**Start Date:** ${contest.start_date ? new Date(contest.start_date).toLocaleString() : "Not set"}`,
          `**End Date:** ${contest.end_date ? new Date(contest.end_date).toLocaleString() : "Not set"}`
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