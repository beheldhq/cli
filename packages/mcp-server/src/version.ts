/**
 * Single source of truth for the MCP server's version string.
 *
 * Imported by:
 *   - server.ts        → `serverInfo.version` in the MCP handshake and `/health` payload
 *   - stdio-server.ts  → `serverInfo.version` on the stdio transport
 *   - notifications.ts → compared against the latest version from the
 *     backend (trigger for the "update available" notification)
 *
 * Bumping on release: edit only this file. Kept aligned with
 * `packages/cli/src/version.ts` because `beheld doctor` reports the CLI
 * version and the version served on `/health` side by side.
 */
export const VERSION = "0.5.2";
