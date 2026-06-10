import type { Lang } from "../i18n/install";

export type Section = "preflight" | "install" | "verify";

export interface StepResult {
  ok: boolean;
  detail?: string;
  /**
   * Overrides the label from labelKey. Useful when the action has a
   * descriptive result ("Daemons already running" vs "daemons started")
   * that should replace the default label instead of appearing as detail.
   */
  overrideLabel?: string;
  errorReason?: string;
  errorSeeAlso?: string;
}

export interface Step {
  section: Section;
  labelKey: string;
  /** When false, the step is treated as verify (status labels). When true, action (✓/✗). */
  isAction: boolean;
  run: () => Promise<StepResult>;
}

// "running" exists only as a transient state during state.step.run(); the
// renderer doesn't show this phase in append-only mode (a line only appears
// when the step completes).
export type StepUiStatus = "pending" | "running" | "ok" | "error";

export interface StepState {
  step: Step;
  status: StepUiStatus;
  result?: StepResult;
  durationMs?: number;
}

export interface InstallReport {
  steps: StepState[];
  errors: StepState[];
  succeeded: boolean;
}

export interface RenderEnv {
  tty: boolean;
  color: boolean;
  lang: Lang;
  termWidth: number;
}
