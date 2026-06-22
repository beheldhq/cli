import { t, type Lang } from "../i18n/install";
import { RESET, DIM } from "../ui/styles";
import { mark, type BrandEnv } from "../brand";
import type { InstallReport, RenderEnv, StepState } from "./types";

/** Bridge the install flow's boolean color flag to a BrandEnv so the [#] mark
 *  paints its cursor green only when colour is on (and degrades to plain). */
function brandEnv(color: boolean): BrandEnv {
  return { tty: color, color, truecolor: color, width: 80 };
}

// ── B3 colors ───────────────────────────────────────────────────────────────

/** Brand bronze (#c9a96e) in ANSI truecolor. */
export const BRONZE = "\x1b[38;2;201;169;110m";
/** Red ANSI 31 — aligned with styles.ts. */
export const RED = "\x1b[31m";

function colorize(s: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${s}${RESET}` : s;
}

function dimize(s: string, enabled: boolean): string {
  return enabled ? `${DIM}${s}${RESET}` : s;
}

// ── render environment ──────────────────────────────────────────────────────

export function detectRenderEnv(opts: { lang: Lang }): RenderEnv {
  const tty = !!process.stdout.isTTY;
  const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
  return {
    tty,
    color: tty && !noColor,
    lang: opts.lang,
    termWidth: process.stdout.columns ?? 80,
  };
}

// ── primitives ──────────────────────────────────────────────────────────────

/** Step line: "  ✓ label (detail)" or "  ✗ label". */
export function renderActionStep(opts: {
  ok: boolean | null;
  label: string;
  detail?: string;
  color: boolean;
}): string {
  const { ok, label, detail, color } = opts;
  const sym =
    ok === null
      ? dimize("…", color)
      : ok
      ? colorize("✓", BRONZE, color)
      : colorize("✗", RED, color);
  const tail = detail ? ` ${dimize(detail, color)}` : "";
  return `    ${sym} ${label}${tail}`;
}

/** Section header: "  · pre-flight". */
export function renderSectionHeader(name: string, color: boolean): string {
  return `  ${colorize("·", BRONZE, color)} ${name}`;
}

/**
 * Append-only render of ONE step that just completed.
 * Returns 1-3 lines: the step line + optional error lines (reason, see).
 */
export function renderStepCompletion(state: StepState, env: RenderEnv): string[] {
  const label = state.result?.overrideLabel ?? t(state.step.labelKey, env.lang);
  const lines: string[] = [];
  lines.push(
    renderActionStep({
      ok: state.status === "ok",
      label,
      detail: state.result?.detail,
      color: env.color,
    }),
  );
  if (state.status === "error" && state.result) {
    if (state.result.errorReason) {
      lines.push(
        `        ${dimize(
          `${t("install.error.reason", env.lang)}: ${state.result.errorReason}`,
          env.color,
        )}`,
      );
    }
    if (state.result.errorSeeAlso) {
      lines.push(
        `        ${dimize(
          `${t("install.error.see", env.lang)}:    ${state.result.errorSeeAlso}`,
          env.color,
        )}`,
      );
    }
  }
  return lines;
}

// ── opener / closer ──────────────────────────────────────────────────────────

export function renderOpener(env: RenderEnv): string {
  const glyph = `  ${mark(brandEnv(env.color))}  `;
  return `${glyph}${t("install.opener", env.lang)}`;
}

/**
 * Visible counter disclosure. Shown ONCE, on first install, between the
 * opener and the first `· pre-flight`. Prints the literal payload
 * (id + os + version) so the user can see exactly what's being sent.
 *
 * When BEHELD_NO_TELEMETRY=1, this function must not be called — the
 * caller filters that out beforehand.
 */
export function renderCounterDisclosure(
  payload: { id: string; os: string; version: string },
  env: RenderEnv,
): string[] {
  const glyph = `  ${mark(brandEnv(env.color))}  `;
  const payloadJson = `{ id: ${payload.id}, os: ${payload.os}, version: ${payload.version} }`;
  return [
    `${glyph}${t("counter.heading", env.lang)}`,
    `     ${dimize(`${t("counter.sent", env.lang)}: ${payloadJson}`, env.color)}`,
    `     ${dimize(t("counter.disable", env.lang), env.color)}`,
  ];
}

export function renderCloser(report: InstallReport, env: RenderEnv): string {
  const glyph = `  ${mark(brandEnv(env.color))}  `;
  if (report.succeeded) {
    return [
      `${glyph}${t("install.closer.ok.l1", env.lang)}`,
      `     ${t("install.closer.ok.l2", env.lang)}`,
      `     ${dimize(t("install.closer.ok.l3", env.lang), env.color)}`,
      `     ${dimize(t("install.closer.signoff", env.lang), env.color)}`,
    ].join("\n");
  }
  const firstError = report.errors[0];
  const errorLabel = firstError
    ? firstError.result?.overrideLabel ?? t(firstError.step.labelKey, env.lang)
    : t("install.section.install", env.lang);
  return [
    `${glyph}${t("install.closer.partial.l1", env.lang, { label: errorLabel })}`,
    `     ${t("install.closer.partial.l2", env.lang)}`,
    `     ${dimize(t("install.closer.signoff", env.lang), env.color)}`,
  ].join("\n");
}
