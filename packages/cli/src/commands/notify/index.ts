/**
 * `beheld notify` — factory for the notify-channel command group.
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 *
 * Auth: Bearer via authenticatedFetch (módulo 2A).
 * Storage: ~/.beheld/config.json (notify_* keys; bearer fica em
 * ~/.beheld/session.json — credential vs preference).
 */

import { Command } from "commander";

export function notifyCommand(): Command {
  const notify = new Command("notify")
    .description("Manage the developer communication email channel");

  notify
    .command("email [address]")
    .description("Add, swap, or remove a notification or recovery email")
    .option("--purpose <purpose>", "notification | recovery (default: notification)")
    .option("--remove", "Remove the email registered for --purpose")
    .option("-y, --yes", "Skip the interactive confirmation")
    .action(async (address: string | undefined, opts: { purpose?: string; remove?: boolean; yes?: boolean }) => {
      const { notifyEmailCommand } = await import("./email");
      await notifyEmailCommand(address, opts);
    });

  notify
    .command("settings")
    .description("Update granular notify consents (security/recovery/bundle_events/weekly)")
    .option("--security <on|off>", "Enable or disable critical security alerts")
    .option("--recovery <on|off>", "Enable or disable identity-recovery communication")
    .option("--bundle-events <on|off>", "Enable or disable bundle verification notifications")
    .option("--weekly <on|off>", "Enable or disable the weekly digest")
    .option("--off", "Disable everything (shortcut)")
    .option("--threshold <N>", "Delta threshold for the weekly digest (1-50)")
    .option("--silent-weeks <policy>", "notify | skip — policy for cycles with no delta")
    .option("--show", "Print the current local state without changing anything")
    .action(async (opts) => {
      const { notifySettingsCommand } = await import("./settings");
      await notifySettingsCommand(opts);
    });

  notify
    .command("status")
    .description("Show the canonical notify-channel state from the portal")
    .option("--json", "Emit JSON instead of human-readable text")
    .action(async (opts) => {
      const { notifyStatusCommand } = await import("./status");
      await notifyStatusCommand(opts);
    });

  notify
    .command("machines")
    .description("List or unlink machines sharing the same notification email")
    .option("--unlink <fingerprint_short>", "Unlink a sibling machine by its truncated fingerprint")
    .option("-y, --yes", "Skip the interactive confirmation when unlinking")
    .option("--json", "Emit JSON instead of human-readable text")
    .action(async (opts) => {
      const { notifyMachinesCommand } = await import("./machines");
      await notifyMachinesCommand(opts);
    });

  return notify;
}
