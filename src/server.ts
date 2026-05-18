import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./utils/logger.js";
import { surveysHandler } from "./domains/surveys.js";
import { usersHandler } from "./domains/users.js";
import { badgesHandler } from "./domains/badges.js";
import { prizesHandler } from "./domains/prizes.js";
import type { CallToolResult, DomainHandler } from "./utils/types.js";

const HANDLERS: DomainHandler[] = [
  surveysHandler,
  usersHandler,
  badgesHandler,
  prizesHandler,
];

const ALL_TOOLS = HANDLERS.flatMap((h) => h.tools);

const TOOL_HANDLERS = new Map<string, DomainHandler>();
for (const handler of HANDLERS) {
  for (const tool of handler.tools) {
    if (TOOL_HANDLERS.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    TOOL_HANDLERS.set(tool.name, handler);
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: "crewhu-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    logger.info("Tool call", { tool: name });

    const handler = TOOL_HANDLERS.get(name);
    if (!handler) {
      const result: CallToolResult = {
        content: [{ type: "text", text: `Unknown tool: '${name}'` }],
        isError: true,
      };
      return result;
    }

    try {
      return await handler.handleCall(name, args as Record<string, unknown>);
    } catch (error) {
      logger.error("Tool call failed", { tool: name, error });
      const message = error instanceof Error ? error.message : String(error);
      const result: CallToolResult = {
        content: [{ type: "text", text: `Error executing ${name}: ${message}` }],
        isError: true,
      };
      return result;
    }
  });

  return server;
}
