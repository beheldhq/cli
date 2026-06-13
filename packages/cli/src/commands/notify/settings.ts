/**
 * `beheld notify settings [flags]`
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import { readNotifyState, writeNotifyState } from "../../storage/notify";
import { EXIT, defaultIdentityClient, describeError, onOff } from "./shared";
import type {
  IdentityClient,
  NotifyUpdatePayload,
  SilentWeeksPolicy,
} from "../../client/identity";

export interface NotifySettingsOptions {
  security?: string;
  recovery?: string;
  bundleEvents?: string;
  weekly?: string;
  off?: boolean;
  threshold?: string;
  silentWeeks?: string;
  show?: boolean;
}

export interface NotifySettingsDeps {
  client?: IdentityClient;
  log?: (msg: string) => void;
  errLog?: (msg: string) => void;
  exit?: (code: number) => never;
  writeNotifyState?: typeof writeNotifyState;
  readNotifyState?: typeof readNotifyState;
  now?: () => Date;
}

export async function notifySettingsCommand(
  opts: NotifySettingsOptions,
  deps: NotifySettingsDeps = {},
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errLog = deps.errLog ?? ((m) => console.error(m));
  const exit = deps.exit ?? ((c) => process.exit(c) as never);
  const writeState = deps.writeNotifyState ?? writeNotifyState;
  const readState = deps.readNotifyState ?? readNotifyState;
  const now = deps.now ?? (() => new Date());

  const showOnly =
    opts.show === true ||
    Object.values({
      security: opts.security,
      recovery: opts.recovery,
      bundleEvents: opts.bundleEvents,
      weekly: opts.weekly,
      off: opts.off,
      threshold: opts.threshold,
      silentWeeks: opts.silentWeeks,
    }).every((v) => v === undefined || v === false);

  if (showOnly) {
    const state = readState();
    log(JSON.stringify(state, null, 2));
    return exit(EXIT.OK);
  }

  const patch: NotifyUpdatePayload = {};

  if (opts.off) {
    patch.security = false;
    patch.recovery = false;
    patch.bundle_events = false;
    patch.weekly = false;
  } else {
    const s = onOff(opts.security);
    if (s !== undefined) patch.security = s;
    const r = onOff(opts.recovery);
    if (r !== undefined) patch.recovery = r;
    const b = onOff(opts.bundleEvents);
    if (b !== undefined) patch.bundle_events = b;
    const w = onOff(opts.weekly);
    if (w !== undefined) patch.weekly = w;
  }

  if (opts.threshold !== undefined) {
    const n = Number.parseInt(opts.threshold, 10);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      errLog("threshold deve ser inteiro entre 1 e 50.");
      return exit(EXIT.ARG);
    }
    patch.delta_threshold = n;
  }

  if (opts.silentWeeks !== undefined) {
    if (opts.silentWeeks !== "notify" && opts.silentWeeks !== "skip") {
      errLog("--silent-weeks deve ser 'notify' ou 'skip'.");
      return exit(EXIT.ARG);
    }
    patch.silent_weeks_policy = opts.silentWeeks as SilentWeeksPolicy;
  }

  if (Object.keys(patch).length === 0) {
    errLog("Nenhuma alteração fornecida.");
    return exit(EXIT.ARG);
  }

  const client = deps.client ?? defaultIdentityClient();
  try {
    await client.patchNotify(patch);
  } catch (err) {
    const { message, code } = describeError(err);
    errLog(message);
    return exit(code);
  }

  // Mirror the patch into config.json. notify_consents is the union of the
  // four booleans; we re-read so we preserve any fields the patch didn't
  // touch.
  const current = readState();
  const consents = {
    security: patch.security ?? current.notify_consents?.security ?? true,
    recovery: patch.recovery ?? current.notify_consents?.recovery ?? true,
    bundle_events: patch.bundle_events ?? current.notify_consents?.bundle_events ?? false,
    weekly: patch.weekly ?? current.notify_consents?.weekly ?? false,
  };

  let weeklyState = current.notify_weekly;
  if (patch.weekly === true && !current.notify_consents?.weekly) {
    // Just enabled — seed the next signal window so module 5 has a schedule.
    const nextSignal = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    weeklyState = {
      enabled: true,
      delta_threshold: patch.delta_threshold ?? current.notify_weekly?.delta_threshold ?? 3,
      last_signal_payload: null,
      last_signal_sent_at: null,
      next_signal_at: nextSignal,
    };
    log(`Próximo digest esperado em ${nextSignal}.`);
  } else if (patch.weekly === false && weeklyState) {
    weeklyState = { ...weeklyState, enabled: false, next_signal_at: null };
  } else if (patch.delta_threshold !== undefined && weeklyState) {
    weeklyState = { ...weeklyState, delta_threshold: patch.delta_threshold };
  }

  writeState({
    notify_consents: consents,
    ...(weeklyState ? { notify_weekly: weeklyState } : {}),
    ...(patch.silent_weeks_policy ? { notify_silent_weeks_policy: patch.silent_weeks_policy } : {}),
  });

  log("Preferências de notificação atualizadas.");
  return exit(EXIT.OK);
}
