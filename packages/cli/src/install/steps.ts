/**
 * Real B3 install steps. Each step is a lightweight probe returning StepResult.
 *
 * Pre-flight = passive observations (no state change, validates environment).
 * Install    = state-changing actions (from WizardActions, threaded from outside).
 * Verify     = post-install observations (depends on the daemon being up).
 */
import { existsSync, statSync, readdirSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import type { Step, StepResult } from "./types";
import type { WizardEnvironments } from "../types";
import type { SetupActions } from "../ui/wizard";
import { engineHealthy, pidListeningOn } from "../util/ports";
import {
  LAUNCH_AGENT_LABEL,
  SYSTEMD_SERVICE_NAME,
  launchAgentPlistPath,
  systemdUnitPath,
} from "../daemon-manager";
import { spawnSync } from "node:child_process";

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

// ── pre-flight ──────────────────────────────────────────────────────────────

async function detectPlatform(): Promise<StepResult> {
  return { ok: true, detail: `${platform()} ${arch()}` };
}

async function ensureDataDirOk(): Promise<StepResult> {
  const dir = beheldDir();
  if (!existsSync(dir)) {
    // Don't create here (init.ts:mkdirSync handles that). Report ok even
    // if missing — the install action will create it.
    return { ok: true, detail: "to be created" };
  }
  try {
    const st = statSync(dir);
    const mode = st.mode & 0o777;
    if (mode === 0o700) return { ok: true };
    return { ok: true, detail: `mode ${mode.toString(8)}` };
  } catch (e) {
    return {
      ok: false,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── verify ───────────────────────────────────────────────────────────────────

async function verifyHttpHealth(port: number): Promise<StepResult> {
  const healthy = await engineHealthy(port, 1500);
  if (healthy) return { ok: true };
  const pid = pidListeningOn(port);
  return {
    ok: false,
    errorReason: pid
      ? `/health timeout on :${port} (PID ${pid})`
      : `no listener on :${port}`,
    errorSeeAlso: "~/.beheld/install.log",
  };
}

function verifyAutostartSync(): StepResult {
  const p = platform();
  if (p === "darwin") {
    if (!existsSync(launchAgentPlistPath())) {
      return { ok: false, errorReason: `LaunchAgent ${LAUNCH_AGENT_LABEL} missing` };
    }
    const r = spawnSync("launchctl", ["list", LAUNCH_AGENT_LABEL], { stdio: "pipe" });
    if (r.status !== 0) {
      return { ok: false, errorReason: `${LAUNCH_AGENT_LABEL} installed but not loaded` };
    }
    return { ok: true };
  }
  if (p === "linux") {
    if (!existsSync(systemdUnitPath())) {
      return { ok: false, errorReason: `${SYSTEMD_SERVICE_NAME} missing` };
    }
    const enabled = spawnSync("systemctl", ["--user", "is-enabled", SYSTEMD_SERVICE_NAME], { stdio: "pipe" });
    const state = (enabled.stdout?.toString() ?? "").trim();
    if (state === "enabled" || state === "static") return { ok: true };
    return { ok: false, errorReason: `systemctl --user is-enabled = ${state || "?"}` };
  }
  // Platforms with no known autostart → ok, unsupported.
  return { ok: true, detail: "not applicable on this platform" };
}

async function verifyJsonlPipeline(): Promise<StepResult> {
  const sessionsDir = join(beheldDir(), "sessions");
  if (!existsSync(sessionsDir)) {
    return { ok: false, errorReason: `${sessionsDir} does not exist` };
  }
  try {
    const st = statSync(sessionsDir);
    const mode = st.mode & 0o777;
    if (mode !== 0o700) {
      return { ok: true, detail: `mode ${mode.toString(8)}` };
    }
    // Best-effort listing to confirm readability.
    readdirSync(sessionsDir);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── builder ──────────────────────────────────────────────────────────────────

/**
 * Builds the linear list of steps from the user's choices.
 * `actions` comes from the `WizardActions` already populated by `initCommand`.
 */
export function buildInstallSteps(
  envChoices: WizardEnvironments,
  actions: SetupActions,
): Step[] {
  const steps: Step[] = [];

  // PRE-FLIGHT
  steps.push({
    section: "preflight",
    labelKey: "install.preflight.platform",
    isAction: true,
    run: detectPlatform,
  });
  steps.push({
    section: "preflight",
    labelKey: "install.preflight.dataDir",
    isAction: true,
    run: ensureDataDirOk,
  });
  if (actions.migrateProjectScoped) {
    steps.push({
      section: "preflight",
      labelKey: "install.preflight.migrate",
      isAction: true,
      run: async () => {
        const n = await actions.migrateProjectScoped!();
        return {
          ok: true,
          detail: n > 0 ? `(${n} migrated)` : undefined,
        };
      },
    });
  }

  // INSTALL
  if (actions.extractEngine) {
    steps.push({
      section: "install",
      labelKey: "install.install.engine",
      isAction: true,
      run: async () => {
        const t0 = Date.now();
        try {
          await actions.extractEngine!();
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          return { ok: true, detail: `(${elapsed}s)` };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (envChoices.claudeCode && actions.installClaudeHooks) {
    steps.push({
      section: "install",
      labelKey: "install.install.claudeHooks",
      isAction: true,
      run: async () => {
        try {
          await actions.installClaudeHooks!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (envChoices.continueDev && actions.installContinueMcp) {
    steps.push({
      section: "install",
      labelKey: "install.install.continueMcp",
      isAction: true,
      run: async () => {
        try {
          await actions.installContinueMcp!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (actions.installAutostart) {
    steps.push({
      section: "install",
      labelKey: "install.install.autostart",
      isAction: true,
      run: async () => {
        try {
          await actions.installAutostart!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (actions.startDaemons) {
    steps.push({
      section: "install",
      labelKey: "install.install.start",
      isAction: true,
      run: async () => {
        try {
          const result = await actions.startDaemons!();
          // startDaemons returns a descriptive string (dynamic label) or void.
          // We use it as overrideLabel to replace "daemons started" with the
          // real state ("Daemons already running" / "Daemons started"),
          // avoiding redundant output.
          if (typeof result === "string") {
            return { ok: true, overrideLabel: result };
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }

  // VERIFY
  steps.push({
    section: "verify",
    labelKey: "install.verify.mcp",
    isAction: false,
    run: () => verifyHttpHealth(7337),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.engine",
    isAction: false,
    run: () => verifyHttpHealth(7338),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.autostart",
    isAction: false,
    run: async () => verifyAutostartSync(),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.jsonl",
    isAction: false,
    run: verifyJsonlPipeline,
  });

  return steps;
}
