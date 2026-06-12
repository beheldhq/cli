import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runWizard } from "../ui/wizard";
import { installClaudeCodeHooks, installContinueDevMcp, installClaudeSlashCommand, installClaudeMcpServer, migrateProjectScopedRegistrations } from "../config/hooks";
import * as daemonManager from "../daemon-manager";
import { ensureSecurePermissions } from "../daemon-manager";
import { hashInstallId, readInstallId } from "../lib/install-id";
import { capture } from "../lib/telemetry-client";
import type { BeheldConfig, TelemetryConfig } from "../types";
import { VERSION } from "../version";

function configPath(): string {
  return join(homedir(), ".beheld", "config.json");
}

function readConfig(): BeheldConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as BeheldConfig;
  } catch {
    return null;
  }
}

async function askReinit(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Beheld is already configured. Reinitialize? [y/N] ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "y");
    });
  });
}

/**
 * Asks the user once, during `beheld init`, whether to allow the daily
 * anonymous ping. Default is Y on TTY, denied on non-interactive runs.
 * The choice is persisted to config.telemetry in the caller.
 */
async function askTelemetryConsent(): Promise<TelemetryConfig> {
  const now = new Date().toISOString();
  if (!process.stdin.isTTY) {
    console.log("Telemetry consent skipped (non-interactive). Run `beheld telemetry enable` to allow.");
    return { consent: "denied", consented_at: now };
  }

  console.log("");
  console.log("─ ( · · · ⊙ · · · ) ─");
  console.log("B3H31D phones home once a day with: version, OS, architecture.");
  console.log("Nothing about your work leaves your machine.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => {
    rl.question("Allow? [Y/n] ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (answer === "n" || answer === "no") {
    return { consent: "denied", consented_at: now };
  }
  return { consent: "granted", consented_at: now };
}

export async function initCommand(
  opts: { force?: boolean; lang?: string } = {},
): Promise<void> {
  const { isLang } = await import("../i18n/install");
  const lang = opts.lang && isLang(opts.lang) ? opts.lang : "en";

  ensureSecurePermissions();
  // Generate Ed25519 signing keys on first run (silent if already present).
  // Required for `beheld snapshot` (Phase 5 — signed .beheld).
  const { ensureKeysSilent } = await import("./keys");
  await ensureKeysSilent();

  const existing = readConfig();
  if (existing && !opts.force) {
    const reinit = await askReinit();
    if (!reinit) {
      console.log("Aborted.");
      return;
    }
  }

  const result = await runWizard(
    {
      migrateProjectScoped: () => migrateProjectScopedRegistrations(),
      installClaudeHooks: async () => {
        await installClaudeCodeHooks();
        await installClaudeMcpServer();
        await installClaudeSlashCommand();
      },
      installContinueMcp: async () => {
        await installContinueDevMcp();
      },
      extractEngine: async () => {
        const { ensureEngine } = await import("../engine-extractor");
        return ensureEngine();
      },
      startDaemons: async () => {
        const result = await daemonManager.start();
        if (result.alreadyRunning) return "Daemons already running";
        if (result.mcp && result.engine) return "Daemons started";
        return `Partial failure — MCP:${result.mcp} Engine:${result.engine}`;
      },
      installAutostart: async () => {
        await daemonManager.installAutostart();
      },
      runBootstrapImport: async (authorEmail: string) => {
        // Persist email immediately so the import loop can pick it up,
        // then enter the interactive loop. The author_email is also returned
        // up the call chain so the final config.json write below preserves it.
        const { runImport, defaultConfigStore } = await import("./import");
        defaultConfigStore.setAuthorEmail(authorEmail);
        await runImport({});
      },
    },
    undefined,
    lang,
  );

  const telemetry = await askTelemetryConsent();

  const config: BeheldConfig = {
    version: VERSION,
    initialized_at: new Date().toISOString(),
    dimensions: result.dimensions,
    environments: result.environments,
    ...(result.author_email ? { author_email: result.author_email } : {}),
    telemetry,
  };

  mkdirSync(join(homedir(), ".beheld"), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");

  if (telemetry.consent === "granted") {
    const id = await readInstallId();
    if (id) {
      void capture({ distinctId: hashInstallId(id), event: "cli_installed" });
    }
  }
}
