import type { DomainHandler, Tool, CallToolResult } from "../utils/types.js";
import type { Survey } from "@wyre-technology/node-crewhu";
import { getClient, formatApiError } from "../utils/client.js";
import { logger } from "../utils/logger.js";

type Sentiment = "positive" | "neutral" | "negative";

/**
 * Crewhu ratings are "5" (positive), "0" (neutral), "-5" (negative), stored
 * as strings. Sentiment filtering happens client-side because the exact
 * server-side type of the rating field is undocumented.
 */
function sentimentOf(survey: Survey): Sentiment | undefined {
  const value = Number(survey.rating);
  if (Number.isNaN(value)) return undefined;
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

const SENTIMENT_ICON: Record<Sentiment, string> = {
  positive: "😀",
  neutral: "😐",
  negative: "😞"
};

function describeRating(survey: Survey): string {
  const sentiment = sentimentOf(survey);
  if (!sentiment) return "No rating";
  const label = survey.rating_label || sentiment.toUpperCase();
  return `${SENTIMENT_ICON[sentiment]} ${label}`;
}

function customerName(survey: Survey): string {
  return (
    survey.customer_data?.name ||
    survey.customer_data?.contact_name ||
    "Unknown customer"
  );
}

function surveyLine(survey: Survey): string[] {
  const date = survey.closed
    ? new Date(survey.closed).toLocaleDateString()
    : "Not answered";
  return [
    `**${customerName(survey)}** - ${describeRating(survey)} - ${date}`,
    survey.summary ? `Ticket ${survey.ticket_num || "?"}: ${survey.summary}` : survey.ticket_num ? `Ticket ${survey.ticket_num}` : "",
    survey.comment ? `"${survey.comment}"` : "No comment provided",
    ""
  ].filter(line => line !== "");
}

function paginationFooter(response: { hasMore: boolean; nextStep?: number | undefined; total: number }): string[] {
  return response.hasMore
    ? [`📄 More results available (total: ${response.total}). Use step=${response.nextStep} for the next page.`]
    : [];
}

const TOOLS: Tool[] = [
  {
    name: "crewhu_surveys_list",
    description: "List customer surveys (CSAT responses) with optional filtering and pagination.",
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
        sentiment: {
          type: "string",
          enum: ["positive", "neutral", "negative"],
          description: "Filter by rating sentiment (positive = rating 5, neutral = 0, negative = -5). Filtered client-side within the fetched page."
        },
        since: {
          type: "string",
          description: 'Return surveys updated since this date (ISO string, e.g., "2026-01-01T00:00:00Z")'
        },
        include_inactive: {
          type: "boolean",
          description: "Include inactive/deleted surveys (default: false, meaning only active)"
        }
      }
    }
  },
  {
    name: "crewhu_surveys_get",
    description: "Get a specific survey by its ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Survey ID (_id)"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "crewhu_surveys_search",
    description: "Search surveys by text in the customer comment, ticket summary, customer name, or ticket number. Searches within the most recent page of surveys (client-side; the API has no search endpoint).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text"
        },
        limit: {
          type: "number",
          description: "Surveys to fetch and search within (default: 100, API max: 100)",
          minimum: 1,
          maximum: 100
        }
      },
      required: ["query"]
    }
  },
  {
    name: "crewhu_surveys_detractors",
    description: "Get recent negative surveys (rating -5) for follow-up and service recovery",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20, max: 100)",
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
    description: "Get recent positive surveys (rating 5) for recognition",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20, max: 100)",
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

async function listBySentiment(
  sentiment: Sentiment,
  limit: number,
  since: string
): Promise<{ items: Survey[]; total: number }> {
  const client = getClient();
  // Sentiment is filtered client-side, so fetch a full page to filter from.
  const response = await client.surveys.list({
    limit: 100,
    _updated_at: { $gte: since }
  });
  const items = response.items
    .filter(s => sentimentOf(s) === sentiment)
    .slice(0, limit);
  return { items, total: response.total };
}

async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getClient();

    switch (name) {
      case "crewhu_surveys_list": {
        const limit = typeof args.limit === "number" ? args.limit : 50;
        const step = typeof args.step === "number" ? args.step : 1;
        const sentiment = args.sentiment as Sentiment | undefined;

        const response = await client.surveys.list({
          limit,
          step,
          ...(args.since ? { _updated_at: { $gte: args.since as string } } : {}),
          ...(args.include_inactive ? {} : { inactive: false })
        });

        const items = sentiment
          ? response.items.filter(s => sentimentOf(s) === sentiment)
          : response.items;

        const summary = [
          `📊 **Surveys** (${items.length} shown, ${response.total} total${sentiment ? `, sentiment=${sentiment} filtered client-side` : ""})`,
          ""
        ];

        if (items.length === 0) {
          summary.push("No surveys found matching the criteria.");
        } else {
          for (const survey of items) {
            summary.push(...surveyLine(survey));
          }
          summary.push(...paginationFooter(response));
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_surveys_get": {
        const id = args.id as string;
        const survey = await client.surveys.get(id);
        const details = [
          `📊 **Survey Details** - ID: ${survey._id}`,
          "",
          `**Customer:** ${customerName(survey)}`,
          `**Contact:** ${survey.customer_data?.contact_name || "Unknown"}`,
          `**Rating:** ${describeRating(survey)}`,
          `**Type:** ${survey.survey_type_code || "Unknown"}`,
          `**Answered:** ${survey.closed ? new Date(survey.closed).toLocaleString() : "Not answered"}`,
          `**Ticket:** ${survey.ticket_num || "None"}${survey.summary ? ` — ${survey.summary}` : ""}`,
          `**Employees credited:** ${survey.employees?.length ? survey.employees.join(", ") : "None"}`,
          `**Reviewed by manager:** ${survey.reviewed ? "Yes" : "No"}`,
          "",
          `**Comment:**`,
          survey.comment || "No comment provided"
        ];

        return {
          content: [{ type: "text", text: details.join("\n") }]
        };
      }

      case "crewhu_surveys_search": {
        const query = args.query as string;
        const limit = typeof args.limit === "number" ? args.limit : 100;
        const response = await client.surveys.search(query, { limit });
        const summary = [
          `🔍 **Search Results for "${query}"** (${response.items.length} found in the ${response.size >= response.total ? "full set" : "most recent page"})`,
          ""
        ];

        if (response.items.length === 0) {
          summary.push("No surveys found matching your search query.");
        } else {
          for (const survey of response.items) {
            summary.push(...surveyLine(survey));
          }
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_surveys_detractors": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const since = (args.since as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { items } = await listBySentiment("negative", limit, since);

        const summary = [
          `😞 **Recent Detractors** (negative rating) - ${items.length} found`,
          ""
        ];

        if (items.length === 0) {
          summary.push("No recent detractors found. Great job! 🎉");
        } else {
          for (const survey of items) {
            summary.push(...surveyLine(survey));
          }
          summary.push("💡 Consider reaching out to these customers for follow-up and service recovery.");
        }

        return {
          content: [{ type: "text", text: summary.join("\n") }]
        };
      }

      case "crewhu_surveys_promoters": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const since = (args.since as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { items } = await listBySentiment("positive", limit, since);

        const summary = [
          `🌟 **Recent Promoters** (positive rating) - ${items.length} found`,
          ""
        ];

        if (items.length === 0) {
          summary.push("No recent promoters found.");
        } else {
          for (const survey of items) {
            summary.push(...surveyLine(survey));
          }
          summary.push("🏆 Consider recognizing the credited employees for excellent customer service!");
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
