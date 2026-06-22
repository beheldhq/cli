import { createWriteStream, existsSync } from "node:fs";
import { chmod, rename, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { getApiUrl } from "../config/env";
import * as daemonManager from "../daemon-manager";
import { GREEN, RED, DIM, BOLD, RESET, brand } from "../ui/styles";
import { VERSION } from "../version";

// Canonical release repo. Must match install.sh's REPO and where release.yml
// publishes (beheldhq/cli). The old eduardovrocha/beheld path was stale from
// before the org move and broke `beheld update` once the API advertised a
// version only published to beheldhq/cli.
const RELEASES_BASE = "https://github.com/beheldhq/cli/releases/download";

function platform(): string {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  return "linux-x64";
}

async function askConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "y" || ans.trim() === "");
    });
  });
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${getApiUrl()}/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const body = res.body;
  if (!body) throw new Error("Empty response body");

  const tmp = `${dest}.tmp`;
  const ws = createWriteStream(tmp);
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        ws.write(value, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    ws.end();
    await new Promise<void>((resolve) => ws.on("finish", resolve));
  }

  await rename(tmp, dest);
}

async function verifySha256(file: string, expected: string): Promise<boolean> {
  const proc = Bun.spawn(["shasum", "-a", "256", file], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  const actual = output.split(" ")[0];
  return actual === expected;
}

export async function updateCommand(): Promise<void> {
  console.log(brand("looking for a newer version"));
  process.stdout.write("  Checking available version…");
  const latest = await fetchLatestVersion();
  process.stdout.write("\r                                    \r");

  if (!latest) {
    console.log(`${DIM}Could not check available version.${RESET}`);
    return;
  }

  if (latest === VERSION) {
    console.log(`${GREEN}✓${RESET}  Beheld ${BOLD}${VERSION}${RESET} is already the latest version.`);
    return;
  }

  console.log(`  Beheld ${BOLD}${latest}${RESET} available  ${DIM}(current: ${VERSION})${RESET}`);
  const confirmed = await askConfirm("  Update now? [Y/n] ");
  if (!confirmed) {
    console.log("Aborted.");
    return;
  }

  const plat = platform();
  const binaryName = `beheld-${plat}`;
  const binaryUrl = `${RELEASES_BASE}/v${latest}/${binaryName}`;
  const checksumUrl = `${RELEASES_BASE}/v${latest}/${binaryName}.sha256`;
  const currentBinary = process.execPath;
  const tmpDest = `${currentBinary}.new`;

  process.stdout.write(`  Downloading ${binaryName}…`);
  try {
    await downloadFile(binaryUrl, tmpDest);
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Downloading ${binaryName}\n`);
  } catch (err) {
    process.stdout.write(`\r  ${RED}✗${RESET}  Download error: ${err instanceof Error ? err.message : String(err)}\n`);
    if (existsSync(tmpDest)) await unlink(tmpDest).catch(() => {});
    process.exit(1);
  }

  process.stdout.write("  Verifying checksum…");
  try {
    const checksumRes = await fetch(checksumUrl, { signal: AbortSignal.timeout(5000) });
    if (checksumRes.ok) {
      const expected = (await checksumRes.text()).trim().split(/\s+/)[0];
      const ok = await verifySha256(tmpDest, expected);
      if (!ok) {
        process.stdout.write(`\r  ${RED}✗${RESET}  Invalid checksum — aborting\n`);
        await unlink(tmpDest).catch(() => {});
        process.exit(1);
      }
    }
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Verifying checksum\n`);
  } catch {
    process.stdout.write(`\r  ${DIM}~${RESET}  Checksum skipped\n`);
  }

  process.stdout.write("  Replacing binary…");
  try {
    await chmod(tmpDest, 0o755);
    await rename(tmpDest, currentBinary);
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Replacing binary\n`);
  } catch (err) {
    process.stdout.write(`\r  ${RED}✗${RESET}  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  process.stdout.write("  Restarting daemon…");
  try {
    const running = await daemonManager.isRunning();
    if (running) {
      await daemonManager.stop();
      await daemonManager.start();
    }
    process.stdout.write(`\r  ${GREEN}✓${RESET}  Restarting daemon\n`);
  } catch {
    process.stdout.write(`\r  ${DIM}~${RESET}  Daemon was not running\n`);
  }

  console.log(`\n  ${GREEN}Updated to ${latest}${RESET}`);
}
