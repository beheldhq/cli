/**
 * Storage helpers for the notify-channel keys inside `~/.beheld/config.json`.
 *
 * Module 2 of 6 — `cli/notify-commands`. Keys exposed:
 *   - notification_email, recovery_email
 *   - notify_consents
 *   - notify_weekly
 *   - notify_silent_weeks_policy
 *   - notify_secondary_offer_shown
 *
 * Why we extend `config.json` instead of using a separate `notify.json`:
 * `BeheldConfig.email_recovery` was already cached in `config.json` (see
 * `share.ts`), so the pattern was set. Decision C, round 5.
 *
 * The bearer credential stays in `~/.beheld/session.json` — credential vs
 * preference are different domains (see module 2A `storage/session.ts`).
 *
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import {
  configPath,
  readConfig,
  writeConfig,
} from "../commands/share";
import type {
  BeheldConfig,
  NotifyConsents,
  NotifyEmailRecord,
  NotifyWeeklyState,
} from "../types";

/** The shape returned by readNotifyState: every notify_* field as-stored,
 *  with `undefined` when the key is absent. Callers branch on presence. */
export interface NotifyState {
  notification_email?: NotifyEmailRecord;
  recovery_email?: NotifyEmailRecord;
  notify_consents?: NotifyConsents;
  notify_weekly?: NotifyWeeklyState;
  notify_silent_weeks_policy?: "notify" | "skip";
  notify_secondary_offer_shown?: boolean;
}

export type NotifyPurpose = "notification" | "recovery";

const NOTIFY_KEYS: ReadonlyArray<keyof NotifyState> = [
  "notification_email",
  "recovery_email",
  "notify_consents",
  "notify_weekly",
  "notify_silent_weeks_policy",
  "notify_secondary_offer_shown",
] as const;

const DEFAULT_CONFIG: BeheldConfig = {
  version: "0.0.0",
  initialized_at: "",
  dimensions: {
    prompt_quality: false,
    test_maturity: false,
    tech_breadth: false,
    work_hours: false,
    project_type: false,
  },
  environments: { claudeCode: false, continueDev: false },
};

/** Reads the current notify state. Returns an empty object when `config.json`
 *  is missing or unreadable — same semantics as the rest of the CLI. */
export function readNotifyState(path: string = configPath()): NotifyState {
  const cfg = readConfig(path);
  if (!cfg) return {};
  return pickNotify(cfg);
}

/** Merges a partial notify patch into `config.json`. Other keys are
 *  preserved verbatim. Returns the full notify slice after write.
 *
 *  Patching a nested field replaces the whole field — callers that want
 *  to keep prior nested values must spread themselves. */
export function writeNotifyState(
  patch: Partial<NotifyState>,
  path: string = configPath(),
): NotifyState {
  const cfg = readConfig(path) ?? DEFAULT_CONFIG;
  for (const key of NOTIFY_KEYS) {
    if (key in patch) {
      const value = patch[key];
      if (value === undefined) {
        delete (cfg as unknown as Record<string, unknown>)[key];
      } else {
        (cfg as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  writeConfig(cfg, path);
  return pickNotify(cfg);
}

/** Clears notify-channel state for a given purpose (or everything).
 *  `email_recovery` (legacy string) is never touched — it belongs to the
 *  pre-module-2 share flow and is out of scope. */
export function clearNotifyState(
  scope: "all" | NotifyPurpose = "all",
  path: string = configPath(),
): NotifyState {
  if (scope === "notification") {
    return writeNotifyState({ notification_email: undefined }, path);
  }
  if (scope === "recovery") {
    return writeNotifyState({ recovery_email: undefined }, path);
  }
  return writeNotifyState({
    notification_email: undefined,
    recovery_email: undefined,
    notify_consents: undefined,
    notify_weekly: undefined,
    notify_silent_weeks_policy: undefined,
    notify_secondary_offer_shown: undefined,
  }, path);
}

function pickNotify(cfg: BeheldConfig): NotifyState {
  const out: NotifyState = {};
  for (const key of NOTIFY_KEYS) {
    const v = (cfg as unknown as Record<string, unknown>)[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}
