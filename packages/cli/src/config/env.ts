/**
 * Environment resolution for the CLI / MCP server.
 *
 * A single global variable picks which remote backend the CLI talks to:
 *
 *   BEHELD_ENV=production   → beheld.dev + rekor.sigstore.dev   (default)
 *   BEHELD_ENV=development  → localhost:3000 + rekor.sigstage.dev
 *
 * Default is `production` because the CLI is distributed via `curl | sh`
 * to external devs — without any config, it must work against the real
 * infrastructure. Only during local development (by the author) does one
 * export `BEHELD_ENV=development` to point at the local Rails app.
 *
 * Individual env-var overrides still work and take precedence over
 * `BEHELD_ENV`:
 *
 *   process.env.BEHELD_API_URL    → overrides API base
 *   process.env.BEHELD_PORTAL_URL → overrides portal URL
 *   process.env.BEHELD_REKOR_URL  → overrides Rekor URL
 *
 * This preserves all existing tests that set these envs.
 *
 * Resolution is lazy (evaluated at function-call time, not at module load)
 * so tests setting env vars AFTER import still work.
 */

export type BeheldEnv = "production" | "development";

const DEFAULTS = {
  production: {
    api: "https://beheld.dev",
    portal: "https://beheld.dev",
    rekor: "https://rekor.sigstore.dev",
  },
  development: {
    api: "http://localhost:3000",
    portal: "http://localhost:3000",
    rekor: "https://rekor.sigstage.dev",
  },
} as const;

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Reads BEHELD_ENV from the environment. Defaults to `production`.
 *  Unknown values fall back to `production` silently so a typo never
 *  takes the CLI offline. */
export function getEnv(): BeheldEnv {
  const raw = process.env.BEHELD_ENV?.trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") {
    return "development";
  }
  return "production";
}

/** Rails backend base — install register, update, attest, delete,
 *  notifications, etc. Override via `BEHELD_API_URL`. */
export function getApiBaseUrl(): string {
  const override = process.env.BEHELD_API_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].api;
}

/** Public portal (bundle URLs, dashboard, auth). Usually the same as the
 *  API base but kept separate to support a future split. Override via
 *  `BEHELD_PORTAL_URL`. */
export function getPortalUrl(): string {
  const override = process.env.BEHELD_PORTAL_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].portal;
}

/** Public transparency log. Override via `BEHELD_REKOR_URL`. */
export function getRekorUrl(): string {
  const override = process.env.BEHELD_REKOR_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].rekor;
}

/** `<API>/api` — used by subcommands that call the Rails `/api/*` endpoints
 *  (update, install/register, notifications). */
export function getApiUrl(): string {
  return `${getApiBaseUrl()}/api`;
}
