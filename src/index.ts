#!/usr/bin/env node
/**
 * Crewhu MCP Server
 *
 * Transports:
 *   - stdio (default): For local Claude Desktop / CLI usage
 *   - http: For hosted deployment via the WYRE MCP Gateway
 *
 * Auth modes:
 *   - env (default): Credentials from CREWHU_API_TOKEN
 *   - gateway: Credentials injected from X-Crewhu-Api-Token header per request
 *     (isolated via AsyncLocalStorage so concurrent tenants never see each other's tokens).
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./utils/logger.js";
import { credentialStore } from "./utils/credential-store.js";
import { createMcpServer } from "./server.js";

const VERSION = "1.0.0";

async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Crewhu MCP running on stdio");
}

async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      // Liveness: HTTP server is bound. Always 200. In gateway mode the
      // upstream token arrives per-request via header, so process-env creds
      // being absent is normal — gating liveness on them caused a crash-loop
      // on ACA (probe → 503 → kill → restart → repeat). Diagnostic preserved
      // in the body as a non-load-bearing field.
      const hasEnvCreds = !!process.env.CREWHU_API_TOKEN;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          envCredentialsConfigured: hasEnvCreds,
          version: VERSION,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname === "/mcp") {
      let gatewayCreds: { apiToken: string } | null = null;

      if (isGatewayMode) {
        const apiToken = req.headers["x-crewhu-api-token"] as string | undefined;
        if (!apiToken) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing credentials",
              required: ["X-Crewhu-Api-Token"],
            })
          );
          return;
        }
        gatewayCreds = { apiToken };
      }

      const handleMcp = (): void => {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on("close", () => {
          transport.close();
          server.close();
        });

        server
          .connect(transport)
          .then(() => transport.handleRequest(req, res))
          .catch((err) => {
            logger.error("MCP request error", { error: err });
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32603, message: "Internal error" },
                  id: null,
                })
              );
            }
          });
      };

      if (gatewayCreds) {
        credentialStore.run(gatewayCreds, handleMcp);
      } else {
        handleMcp();
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      logger.info(`Crewhu MCP listening on http://${host}:${port}/mcp`);
      logger.info(`Auth mode: ${isGatewayMode ? "gateway" : "env"}`);
      resolve();
    });
  });

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting Crewhu MCP", { transport });
  if (transport === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch((error) => {
  logger.error("Fatal startup error", { error });
  process.exit(1);
});
