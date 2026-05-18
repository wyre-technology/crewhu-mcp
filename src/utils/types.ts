import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { Tool, CallToolResult };

export interface DomainHandler {
  tools: Tool[];
  handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}
