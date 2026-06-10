import { t } from "../i18n/install";
import {
  renderCloser,
  renderCounterDisclosure,
  renderOpener,
  renderSectionHeader,
  renderStepCompletion,
} from "./render";
import type {
  InstallReport,
  RenderEnv,
  Section,
  Step,
  StepState,
} from "./types";

interface Writer {
  write: (s: string) => void;
}

const DEFAULT_WRITER: Writer = {
  write: (s) => process.stdout.write(s),
};

function initialStates(steps: Step[]): StepState[] {
  return steps.map((s) => ({ step: s, status: "pending" }));
}

function isSectionBlocking(section: Section): boolean {
  // Short-circuit rule: pre-flight and install abort subsequent steps in the
  // same section + the following ones on the first failure. Verify is
  // resilient: each item is independent, all run to completion.
  return section === "preflight" || section === "install";
}

/**
 * Serial step execution, APPEND-ONLY mode.
 *
 * Each step that completes prints ONE (or 2-3, on error) lines to stdout.
 * No redraw, no alt screen buffer, no cursor magic. Works in any terminal:
 * Warp, iTerm2, Terminal.app, tmux, ssh, ci.log, pipe.
 *
 * The act of seeing lines appear IS the progress feedback. For a ~3 second
 * install, this is more readable than an animated bar.
 */
export interface RunInstallOpts {
  /**
   * Install counter disclosure. When present, printed between the opener and
   * the first `· pre-flight`. The caller decides whether to include it (checks
   * BEHELD_NO_TELEMETRY, isFirstInstall, etc.); the runner just renders.
   */
  counterPayload?: { id: string; os: string; version: string };
}

export async function runInstall(
  steps: Step[],
  env: RenderEnv,
  writer: Writer = DEFAULT_WRITER,
  opts: RunInstallOpts = {},
): Promise<InstallReport> {
  const states = initialStates(steps);

  // Opener — same format in TTY and non-TTY.
  writer.write(`${renderOpener(env)}\n\n`);

  // Counter disclosure — only on first install and outside opt-out.
  // Caller's decision; here we just render if the payload came through.
  if (opts.counterPayload) {
    for (const line of renderCounterDisclosure(opts.counterPayload, env)) {
      writer.write(`${line}\n`);
    }
    writer.write("\n");
  }

  const printedSections = new Set<Section>();
  let abortRemainingBlocking = false;

  for (const state of states) {
    if (abortRemainingBlocking && isSectionBlocking(state.step.section)) {
      // Skip short-circuited steps — keep status pending; print nothing.
      continue;
    }

    state.status = "running";
    const t0 = Date.now();
    try {
      const result = await state.step.run();
      state.durationMs = Date.now() - t0;
      state.result = result;
      state.status = result.ok ? "ok" : "error";
      if (!result.ok && isSectionBlocking(state.step.section)) {
        abortRemainingBlocking = true;
      }
    } catch (err) {
      state.durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      state.result = { ok: false, errorReason: message };
      state.status = "error";
      if (isSectionBlocking(state.step.section)) {
        abortRemainingBlocking = true;
      }
    }

    // Section header — printed the first time we see this section.
    if (!printedSections.has(state.step.section)) {
      printedSections.add(state.step.section);
      const sectionName = t(`install.section.${state.step.section}`, env.lang);
      writer.write(`${renderSectionHeader(sectionName, env.color)}\n`);
    }

    // Step lines (1 + optional error lines).
    for (const line of renderStepCompletion(state, env)) {
      writer.write(`${line}\n`);
    }
  }

  const errors = states.filter((s) => s.status === "error");
  const report: InstallReport = {
    steps: states,
    errors,
    succeeded: errors.length === 0,
  };

  // Blank line + closer.
  writer.write(`\n${renderCloser(report, env)}\n`);

  return report;
}
