import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

const TOOLS: Tool[] = [
  {
    name: "crewhu_surveys_list",
    description: "List customer surveys with optional filtering and pagination. Returns CSAT and NPS survey responses.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 50, max: 1000)",
          minimum: 1,
          maximum: 1000
        },
        step: {
          type: "number",
          description: "Pagination offset for retrieving next page",
          minimum: 0
        },
        customer: {
          type: "string",
          description: "Filter by customer name"
        },
        agent: {
          type: "string",
          description: "Filter by agent name"
        },
        score_min: {
          type: "number",
          description: "Minimum score filter (for finding promoters use 9+)",
          minimum: 0,
          maximum: 10
        },
        score_max: {
          type: "number",
          description: "Maximum score filter (for finding detractors use 6 or less)",
          minimum: 0,
          maximum: 10
        },
        since: {
          type: "string",
          description: 'Return surveys updated since this date (ISO string, e.g., "2024-01-01T00:00:00Z")'
        }
      }
    }
  },
  {
    name: "crewhu_surveys_get",
    description: "Get a specific survey by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Survey ID"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_surveys_search",
    description: "Search surveys by text content in responses, customer names, or agent names",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50)",
          minimum: 1,
          maximum: 1000
        }
      },
      required: ["query"]
    }
  },
  {
    name: "crewhu_surveys_detractors",
    description: "Get recent low-scoring surveys (detractors with score ≤ 6) for follow-up",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        },
        since: {
          type: "string",
          description: "Return detractors since this date (default: last 30 days)"
        }
      }
    }
  },
  {
    name: "crewhu_surveys_promoters",
    description: "Get recent high-scoring surveys (promoters with score ≥ 9) for recognition",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20)",
          minimum: 1,
          maximum: 100
        },
        since: {
          type: "string",
          description: "Return promoters since this date (default: last 30 days)"
        }
      }
    }
  }
];

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getClient();

    switch (name) {
      case "crewhu_surveys_list": {
        const params: Record<string, unknown> = {
          limit: typeof args.limit === "number" ? args.limit : 50,
          step: typeof args.step === "number" ? args.step : 0
        };

        if (args.customer) params.customer = args.customer;
        if (args.agent) params.agent = args.agent;
        if (args.since) {
          params._updated_at = { $gte: args.since };
        }
        if (args.score_min !== undefined || args.score_max !== undefined) {
          params.score = {};
          if (args.score_min !== undefined) (params.score as Record<string, unknown>).$gte = args.score_min;
          if (args.score_max !== undefined) (params.score as Record<string, unknown>).$lte = args.score_max;
        }

        const response = await client.surveys.list(params);
        const summary = [
          `📊 **Survey Results** (${response.items.length} of ${response.step + response.items.length}+ total)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No surveys found matching the criteria.");
        } else {
          for (const survey of response.items) {
            const score = survey.score ? `${survey.score}/10` : "No score";
            const customer = survey.customer || "Unknown customer";
            const agent = survey.agent || "Unknown agent";
            const date = survey.created_at ? new Date(survey.created_at).toLocaleDateString() : "Unknown date";
            summary.push(
              `**${customer}** (${agent}) - Score: ${score} - ${date}`,
              survey.response ? `"${survey.response}"` : "No response text",
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

      case "crewhu_surveys_get": {
        const id = args.id as string;
        const survey = await client.surveys.get(id);
        const details = [
          `📊 **Survey Details** - ID: ${survey.id}`,
          "",
          `**Customer:** ${survey.customer || "Unknown"}`,
          `**Agent:** ${survey.agent || "Unknown"}`,
          `**Score:** ${survey.score ? `${survey.score}/10` : "No score"}`,
          `**Type:** ${survey.type || "Unknown"}`,
          `**Date:** ${survey.created_at ? new Date(survey.created_at).toLocaleString() : "Unknown"}`,
          `**Ticket:** ${survey.ticket_id || "None"}`,
          "",
          `**Response:**`,
          survey.response || "No response provided"
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_surveys_search": {
        const query = args.query as string;
        const limit = typeof args.limit === "number" ? args.limit : 50;
        const response = await client.surveys.search(query, { limit });
        const summary = [
          `🔍 **Search Results for "${query}"** (${response.items.length} found)`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No surveys found matching your search query.");
        } else {
          for (const survey of response.items) {
            const score = survey.score ? `${survey.score}/10` : "No score";
            const customer = survey.customer || "Unknown customer";
            const agent = survey.agent || "Unknown agent";
            summary.push(
              `**${customer}** (${agent}) - Score: ${score}`,
              survey.response ? `"${survey.response}"` : "No response text",
              ""
            );
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_surveys_detractors": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const since = args.since as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const params = {
          score: { $lte: 6 },
          _updated_at: { $gte: since },
          limit
        };

        const response = await client.surveys.list(params);
        const summary = [
          `😞 **Recent Detractors** (Score ≤ 6) - ${response.items.length} found`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No recent detractors found. Great job! 🎉");
        } else {
          for (const survey of response.items) {
            const score = survey.score || 0;
            const customer = survey.customer || "Unknown customer";
            const agent = survey.agent || "Unknown agent";
            const date = survey.created_at ? new Date(survey.created_at).toLocaleDateString() : "";
            summary.push(
              `⚠️ **${customer}** (${agent}) - Score: ${score}/10 - ${date}`,
              survey.response ? `"${survey.response}"` : "No feedback provided",
              survey.ticket_id ? `Ticket: ${survey.ticket_id}` : "",
              ""
            );
          }
          summary.push("💡 Consider reaching out to these customers for follow-up and service recovery.");
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_surveys_promoters": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const since = args.since as string || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const params = {
          score: { $gte: 9 },
          _updated_at: { $gte: since },
          limit
        };

        const response = await client.surveys.list(params);
        const summary = [
          `🌟 **Recent Promoters** (Score ≥ 9) - ${response.items.length} found`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No recent promoters found.");
        } else {
          for (const survey of response.items) {
            const score = survey.score || 0;
            const customer = survey.customer || "Unknown customer";
            const agent = survey.agent || "Unknown agent";
            const date = survey.created_at ? new Date(survey.created_at).toLocaleDateString() : "";
            summary.push(
              `⭐ **${customer}** (${agent}) - Score: ${score}/10 - ${date}`,
              survey.response ? `"${survey.response}"` : "No feedback provided",
              survey.ticket_id ? `Ticket: ${survey.ticket_id}` : "",
              ""
            );
          }
          summary.push("🏆 Consider recognizing these agents for excellent customer service!");
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      default:
        return {
          content: [{ type: "text", text: `❌ Unknown surveys tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    logger.error("Surveys tool error", { toolName: name, error });
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

export const surveysHandler: DomainHandler = { tools: TOOLS, handleCall };