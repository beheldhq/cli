import * as daemonManager from "../daemon-manager";
import { ok, fail, meta, bold, brand, GREEN, RESET } from "../ui/styles";

export async function restartCommand(): Promise<void> {
  const wasRunning = await daemonManager.isRunning();

  console.log(brand("starting fresh"));

  if (wasRunning) {
    process.stdout.write("  Stopping Beheld…");
    // daemonManager.stop() already SIGTERM with 5s wait, then SIGKILL fallback
    await daemonManager.stop();
    process.stdout.write(`\r${ok(`Beheld stopped     ${meta("(graceful, falls back to kill -9 if needed)")}`)}\n`);
  } else {
    console.log(`  ${meta("Beheld wasn't running — skipping stop.")}`);
  }

  const result = await daemonManager.start();

  if (!result.mcp || !result.engine) {
    if (!result.mcp)    console.log(fail("MCP server failed to start"));
    if (!result.engine) console.log(fail("engine failed to start"));
    console.log("");
    console.log(`  Diagnostics: ${bold("beheld doctor")}`);
    process.exit(1);
  }

  // Final health check: start() already polls /health via waitForHealthPort,
  // but a final explicit verification keeps the contract loud.
  const [mcpOk, engineOk] = await Promise.all([
    daemonManager.isMcpRunning(),
    daemonManager.isEngineRunning(),
  ]);

  if (mcpOk && engineOk) {
    console.log(ok(`MCP server responding on /health     ${meta("port 7337")}`));
    console.log(ok(`Engine responding on /health         ${meta("port 7338")}`));
    console.log("");
    console.log(`  ${GREEN}Beheld restarted successfully.${RESET}`);
    console.log("");
    return;
  }

  if (!mcpOk)    console.log(fail("MCP /health not responding after restart"));
  if (!engineOk) console.log(fail("engine /health not responding after restart"));
  console.log("");
  console.log(`  Diagnostics: ${bold("beheld doctor")}`);
  process.exit(1);
}
