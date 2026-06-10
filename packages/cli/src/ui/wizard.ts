import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WizardDimensions, WizardEnvironments } from "../types";
import { bold, green, dim, RESET, DIM, CYAN, YELLOW, RED } from "./styles";

// ── Privacy strings (Phase 6 — required verbatim by F6.7 spec) ───────────────

/** Exact wording asserted by tests — keep these strings stable. */
export const BOOTSTRAP_PRIVACY_LINES = [
  "Each repository is processed once — reimporting does not change the profile.",
  "Commit messages, branch names, and file contents are never written.",
] as const;

// ── readline helper ───────────────────────────────────────────────────────────

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── environment detection ─────────────────────────────────────────────────────

export function detectEnvironments(base = homedir()): WizardEnvironments {
  return {
    claudeCode: existsSync(join(base, ".claude", "settings.json")),
    continueDev: existsSync(join(base, ".continue", "config.json")),
  };
}

// ── Screen 1 — Transparency ──────────────────────────────────────────────────

async function screen1(rl: ReturnType<typeof createInterface>): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[0;0H"); // clear screen
  console.log(bold(`\n${CYAN}Beheld${RESET} — Onboarding\n`));
  console.log(bold("What is collected?") + "\n");

  const collected = [
    "Tool names (Read, Write, Bash…)",
    "File extensions (.ts, .py, .rb…)",
    "Sanitized Bash commands (no sensitive args)",
    "Prompt length (character count)",
    "Timestamps and session durations",
  ];
  const never = [
    "File contents or prompt text",
    "Environment variables or secrets",
    "Absolute paths (SHA-256 hash only)",
    "API tokens or credentials",
    "Business data or personal information",
  ];

  const maxLen = Math.max(...collected.map((s) => s.length));
  console.log(
    `  ${bold("COLLECTED".padEnd(maxLen + 4))}  ${bold("NEVER COLLECTED")}`,
  );
  console.log("  " + "─".repeat(maxLen + 4) + "  " + "─".repeat(40));
  const rows = Math.max(collected.length, never.length);
  for (let i = 0; i < rows; i++) {
    const left = collected[i] ? green("✓ " + collected[i]) : "";
    const right = never[i] ? `${YELLOW}✗ ${never[i]}${RESET}` : "";
    console.log(`  ${left.padEnd(maxLen + 10)}  ${right}`);
  }

  console.log("\n" + dim("All data stays in ~/.beheld/ — nothing leaves your machine."));
  await prompt(rl, "\nPress Enter to continue…");
}

// ── Tela 2 — Opt-in granular (checkboxes) ────────────────────────────────────

async function screen2(
  rl: ReturnType<typeof createInterface>,
): Promise<WizardDimensions> {
  const items: { key: keyof WizardDimensions; label: string; desc: string; on: boolean }[] = [
    { key: "prompt_quality", label: "prompt_quality", desc: "Quality of your prompts", on: true },
    { key: "test_maturity", label: "test_maturity", desc: "Test and TDD maturity", on: true },
    { key: "tech_breadth", label: "tech_breadth", desc: "Technological diversity", on: true },
    { key: "work_hours", label: "work_hours", desc: "Horários de trabalho (opt-in)", on: false },
    { key: "project_type", label: "project_type", desc: "Tipo de projeto (opt-in)", on: false },
  ];

  while (true) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    console.log(bold("\nTela 2 — Dimensões a analisar\n"));
    items.forEach((item, i) => {
      const check = item.on ? green("[✓]") : `${DIM}[ ]${RESET}`;
      console.log(`  [${i + 1}] ${check}  ${item.label.padEnd(18)} ${dim(item.desc)}`);
    });
    console.log("\n" + dim("Digite números para ativar/desativar (ex: 4 5), Enter para confirmar:"));
    const answer = await prompt(rl, "> ");
    if (answer.trim() === "") break;
    for (const token of answer.trim().split(/\s+/)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= items.length) items[n - 1].on = !items[n - 1].on;
    }
  }

  const result = {} as WizardDimensions;
  for (const item of items) result[item.key] = item.on;
  return result;
}

// ── Tela 3.5 — Git Bootstrap (opcional) ──────────────────────────────────────

export type BootstrapChoice = "import_now" | "later" | "skip";

export interface BootstrapResult {
  choice: BootstrapChoice;
  author_email?: string;
}

export interface BootstrapScreenDeps {
  prompt: (label: string) => Promise<string>;
  log: (msg: string) => void;
  /** Invoked when the user picks [1]. The implementation in initCommand wires
   *  this to the real interactive `runImport` loop. */
  runImportLoop: (authorEmail: string) => Promise<void>;
}

/** Render the bootstrap screen and dispatch to the user's choice.
 *  Pure with respect to IO — all side effects flow through `deps`. */
export async function bootstrapScreen(
  deps: BootstrapScreenDeps,
): Promise<BootstrapResult> {
  deps.log("─────────────────────────────────────────────────────");
  deps.log("Beheld · Git history (optional)");
  deps.log("─────────────────────────────────────────────────────");
  deps.log("");
  deps.log("Your profile starts forming today.");
  deps.log("Want to also load the history of your previous projects?");
  deps.log("");
  deps.log("Beheld can analyze repositories where you have commits and");
  deps.log("extract technical signals — languages, tools, work rhythm.");
  deps.log("");
  deps.log("What is collected:   file extensions, ecosystems, timing");
  deps.log("What is ignored:     commit messages, branch names, file contents");
  deps.log("");
  for (const line of BOOTSTRAP_PRIVACY_LINES) deps.log(line);
  deps.log("");
  deps.log("  [1] Import now");
  deps.log("  [2] Import later  (beheld import)");
  deps.log("  [3] Skip");
  deps.log("");

  // Default to [3] (skip) on empty input so the wizard can never block.
  const raw = (await deps.prompt("> ")).trim();
  const choice: BootstrapChoice =
    raw === "1" ? "import_now" : raw === "2" ? "later" : "skip";

  if (choice === "import_now") {
    const email = (await deps.prompt("What's your git commit email? ")).trim();
    if (!email) {
      deps.log("No email provided. Skipping bootstrap.");
      return { choice: "skip" };
    }
    await deps.runImportLoop(email);
    return { choice, author_email: email };
  }

  if (choice === "later") {
    deps.log("OK. Run beheld import whenever you want.");
    return { choice };
  }

  return { choice };
}

// ── Screen 3 — Environments ──────────────────────────────────────────────────

async function screen3(
  rl: ReturnType<typeof createInterface>,
  base = homedir(),
): Promise<WizardEnvironments> {
  process.stdout.write("\x1b[2J\x1b[0;0H");
  console.log(bold("\nScreen 3 — Detected environments\n"));

  const envs = detectEnvironments(base);

  function detected(found: boolean): string {
    return found ? green("detected") : `${DIM}not found${RESET}`;
  }

  console.log(`  Claude Code     ${detected(envs.claudeCode)}`);
  console.log(`  Continue.dev    ${detected(envs.continueDev)}`);
  console.log("");

  let claudeCode = envs.claudeCode;
  let continueDev = envs.continueDev;

  if (envs.claudeCode) {
    const ans = await prompt(rl, "  Configure Claude Code? [Y/n] ");
    claudeCode = ans.trim().toLowerCase() !== "n";
  }
  if (envs.continueDev) {
    const ans = await prompt(rl, "  Configure Continue.dev? [Y/n] ");
    continueDev = ans.trim().toLowerCase() !== "n";
  }

  return { claudeCode, continueDev };
}

// ── Screen 4 — Progress ──────────────────────────────────────────────────────

export interface SetupActions {
  migrateProjectScoped?: () => Promise<number>;
  installClaudeHooks?: () => Promise<void>;
  installContinueMcp?: () => Promise<void>;
  extractEngine?: () => Promise<string>;
  startDaemons?: () => Promise<string | void>;
  installAutostart?: () => Promise<void>;
}

async function screen4(
  rl: ReturnType<typeof createInterface>,
  environments: WizardEnvironments,
  actions: SetupActions,
  lang: import("../i18n/install").Lang,
): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[0;0H");

  const { buildInstallSteps } = await import("../install/steps");
  const { runInstall } = await import("../install/runner");
  const { detectRenderEnv } = await import("../install/render");
  const { isFirstInstall, isOptedOut, getRegisterPayload, registerFirstInstall } =
    await import("../install/counter");
  const { VERSION } = await import("../index");

  const steps = buildInstallSteps(environments, actions);
  const env = detectRenderEnv({ lang });

  // Cross-repo install counter. Only on the FIRST init run and only if
  // the user hasn't opted out via BEHELD_NO_TELEMETRY. Payload is built
  // BEFORE runInstall so the disclosure shows the real id that will be
  // sent.
  let counterPayload: { id: string; os: string; version: string } | undefined;
  let counterPromise: Promise<unknown> | undefined;
  if (isFirstInstall() && !isOptedOut()) {
    const payload = getRegisterPayload(VERSION);
    if (payload !== null) {
      counterPayload = payload;
      // Fire-and-forget — doesn't block the rest of the install. We
      // capture the promise to await at the end, making sure the process
      // doesn't die before the POST resolves/times out (and the
      // install-id file is written).
      counterPromise = registerFirstInstall(payload);
    }
  }

  await runInstall(steps, env, undefined, { counterPayload });

  if (counterPromise) {
    // Espera o POST resolver (ou timeout em 3s). registerFirstInstall nunca
    // throw — sempre retorna { sent, reason }. Não fazemos nada com o resultado.
    await counterPromise.catch(() => undefined);
  }

  rl.close();
}

// ── Main wizard export ────────────────────────────────────────────────────────

export interface WizardResult {
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
  /** Set only when the user picked [1] on the bootstrap screen and entered
   *  an email. initCommand merges this into the final config.json. */
  author_email?: string;
  bootstrap_choice?: BootstrapChoice;
}

export interface WizardActions extends SetupActions {
  /** Drives Tela 3.5. Provided by initCommand which wires it to the real
   *  interactive import loop. */
  runBootstrapImport?: (authorEmail: string) => Promise<void>;
}

export async function runWizard(
  actions: WizardActions = {},
  homeBase = homedir(),
  lang: import("../i18n/install").Lang = "en",
): Promise<WizardResult> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  await screen1(rl);
  const dimensions = await screen2(rl);

  // Tela 3.5 — Git bootstrap (only meaningful if the host can run the import).
  let bootstrap: BootstrapResult = { choice: "skip" };
  if (actions.runBootstrapImport) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    bootstrap = await bootstrapScreen({
      prompt: (q) => prompt(rl, q),
      log: (m) => console.log(m),
      runImportLoop: actions.runBootstrapImport,
    });
  }

  const environments = await screen3(rl, homeBase);
  await screen4(rl, environments, actions, lang);

  return {
    dimensions,
    environments,
    author_email: bootstrap.author_email,
    bootstrap_choice: bootstrap.choice,
  };
}
