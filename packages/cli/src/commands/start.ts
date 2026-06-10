import * as daemonManager from "../daemon-manager";
import { selfHealClaudeIntegration } from "../config/hooks";
import { ok, fail, meta, bold, brand, GREEN, RESET } from "../ui/styles";

// Recreate the `/beheld` slash command and MCP registration if they went
// missing (e.g. wiped by `beheld delete`). Runs on every start — including
// autostart at login — so the command can never silently stay gone.
async function healIntegration(): Promise<void> {
  try {
    const healed = await selfHealClaudeIntegration();
    if (healed.slashCommandRestored || healed.mcpServerRestored) {
      const what = [
        healed.slashCommandRestored ? "/beheld command" : null,
        healed.mcpServerRestored ? "MCP registration" : null,
      ].filter(Boolean).join(" + ");
      console.log(`  ${meta(`Restored: ${what} (restart Claude Code to use)`)}`);
    }
  } catch {
    /* self-heal is best-effort; never block start */
  }
}

export async function startCommand(): Promise<void> {
  // Explicit user signal: "I want to resume". If the supervisor was suspended
  // by backoff (Layer 2), clear the flag and log "auto-restart resumed" — before
  // anything else.
  daemonManager.clearBackoffStateOnUserStart();

  await healIntegration();

  // Pre-check so we only show the "this might take a while" hint when we're
  // actually about to wait. Engine cold start (PyInstaller bundle extraction
  // on first run) is the slow path — up to ~30s on macOS.
  const [mcpUp, engineUp] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (mcpUp && engineUp) {
    console.log(brand("already up"));
    console.log(`  ${bold("MCP server")}      ${GREEN}●${RESET}  port 7337`);
    console.log(`  ${bold("Scoring engine")}  ${GREEN}●${RESET}  port 7338`);
    console.log("");
    // No need to call daemonManager.start() — return early.
    return;
  }

  console.log(brand("starting daemons"));
  if (!engineUp) {
    console.log(`  ${meta("Engine may take 15-30s on first start…")}`);
  }

  const result = await daemonManager.start();

  if (result.mcp && result.engine) {
    console.log(`\n${ok(`MCP server started     ${meta("port 7337")}`)}`);
    console.log(`${ok(`Engine started         ${meta("port 7338")}`)}\n`);
  } else {
    if (!result.mcp)    console.log(fail("MCP server failed to start"));
    if (!result.engine) console.log(fail("engine failed to start"));
    process.exit(1);
  }
}
