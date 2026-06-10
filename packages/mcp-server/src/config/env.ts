/**
 * Environment resolution for the MCP server.
 *
 * Mirrors `packages/cli/src/config/env.ts`. Kept duplicated (rather than
 * imported via a cross-workspace relative path) to preserve the workspace
 * boundary and allow the MCP server to be published independently later.
 *
 * Identical behavior:
 *   - BEHELD_ENV ∈ {production, development} (default production)
 *   - Individual overrides: BEHELD_API_URL takes precedence
 */

export type BeheldEnv = "production" | "development";

const DEFAULTS = {
  production: { api: "https://beheld.dev" },
  development: { api: "http://localhost:3000" },
} as const;

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getEnv(): BeheldEnv {
  const raw = process.env.BEHELD_ENV?.trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") {
    return "development";
  }
  return "production";
}

export function getApiBaseUrl(): string {
  const override = process.env.BEHELD_API_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].api;
}

export function getApiUrl(): string {
  return `${getApiBaseUrl()}/api`;
}
