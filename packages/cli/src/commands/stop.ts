import * as daemonManager from "../daemon-manager";
import { ok, meta, brand } from "../ui/styles";

export async function stopCommand(): Promise<void> {
  const running = await daemonManager.isRunning();
  if (!running) {
    console.log(brand("nothing to stop"));
    console.log(`  ${meta("Beheld is not running.")}`);
    return;
  }

  console.log(brand("clocking out"));
  process.stdout.write("  Stopping Beheld…");
  await daemonManager.stop();
  process.stdout.write(`\r${ok("Beheld stopped")}\n`);
}
