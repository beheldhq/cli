/**
 * Single source of truth for the CLI's binary version string.
 *
 * Imported by:
 *   - index.ts           → `program.version(VERSION)` and the global `-v`
 *   - commands/init.ts   → written to `~/.beheld/config.json` (audit of
 *     which CLI initialized the config)
 *   - commands/update.ts → compared against the remote version served by
 *     `GET <api>/api/version`
 *   - ui/wizard.ts       → payload of the counter `POST /api/install/register`
 *
 * Bumping on release: edit only this file. The backend (Rails) keeps an
 * explicit mirror in `app/controllers/versions_controller.rb` that needs
 * to be bumped in lockstep on deploy.
 */
export const VERSION = "0.5.3";
