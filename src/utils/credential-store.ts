/**
 * Per-request credential isolation using AsyncLocalStorage.
 *
 * In gateway (HTTP) mode each request carries its own credentials in headers.
 * Storing them in AsyncLocalStorage instead of mutating process.env keeps
 * concurrent tenants isolated. See CLAUDE.md learnings 2026-04-13.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestCredentials {
  apiToken: string;
}

export const credentialStore = new AsyncLocalStorage<RequestCredentials>();

export function getRequestCredentials(): RequestCredentials | undefined {
  return credentialStore.getStore();
}
