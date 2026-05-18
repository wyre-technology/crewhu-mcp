/**
 * Resolve a per-request CrewhuClient.
 *
 * The token comes from AsyncLocalStorage in gateway mode, or from the
 * CREWHU_API_TOKEN env var when running stdio/env mode locally.
 *
 * Clients are cached per token for the lifetime of the process so we don't
 * rebuild the HTTP client / rate limiter on every call, but the cache key
 * is the secret itself, which keeps tenants isolated.
 */

import { CrewhuClient } from "@wyre-technology/node-crewhu";
import { getRequestCredentials } from "./credential-store.js";

const clientCache = new Map<string, CrewhuClient>();

function resolveToken(): string {
  const reqCreds = getRequestCredentials();
  if (reqCreds?.apiToken) return reqCreds.apiToken;
  const envToken = process.env.CREWHU_API_TOKEN;
  if (envToken) return envToken;
  throw new Error(
    "Crewhu API token not available. Set CREWHU_API_TOKEN (stdio mode) or " +
      "ensure the gateway forwards X-Crewhu-Api-Token (gateway mode)."
  );
}

export function getClient(): CrewhuClient {
  const token = resolveToken();
  let client = clientCache.get(token);
  if (!client) {
    client = new CrewhuClient({ apiToken: token });
    clientCache.set(token, client);
  }
  return client;
}

export function formatApiError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { statusCode?: number }).statusCode;
    return status ? `${err.message} (HTTP ${status})` : err.message;
  }
  return String(err);
}
