/**
 * Post-share secondary opt-in offer. Fires at most once per lifetime,
 * gated on a verified notification_email. Asks the dev whether to enable
 * `bundle_events` (notify on third-party verification) and `weekly`
 * (delta digest).
 *
 * Module 3 of 6 — `cli/bootstrap-and-share-prompts`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 *
 * Tom: testemunha, oferta única. Recusa não retorna. Sem CTA exclamativo.
 */

import {
  createIdentityClient,
  type IdentityClient,
} from "../../client/identity";
import { getApiBaseUrl } from "../../config/env";
import { readNotifyState, writeNotifyState } from "../../storage/notify";
import {
  isAffirmative,
  nodeReadlinePrompter,
  type Prompter,
} from "../share";

export interface ShareSecondaryHookDeps {
  prompter?: Prompter;
  identityClient?: IdentityClient;
  readNotifyState?: typeof readNotifyState;
  writeNotifyState?: typeof writeNotifyState;
  isInteractive?: () => boolean;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  now?: () => Date;
}

export type SecondaryHookOutcome =
  | "not_eligible"
  | "skipped_non_interactive"
  | "shown_no_opt_in"
  | "shown_opt_in";

export interface ShareSecondaryHookResult {
  outcome: SecondaryHookOutcome;
  enabled: { bundle_events: boolean; weekly: boolean };
}

/** Eligibility (and side-effects free) — does the local state allow us to
 *  show the offer? Caller branches in tests without needing prompts. */
export function isSecondaryOfferEligible(
  state: ReturnType<typeof readNotifyState>,
): boolean {
  if (state.notify_secondary_offer_shown) return false;
  if (!state.notification_email?.verified) return false;
  return true;
}

export async function runShareSecondaryHook(
  deps: ShareSecondaryHookDeps = {},
): Promise<ShareSecondaryHookResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const readState = deps.readNotifyState ?? readNotifyState;
  const writeState = deps.writeNotifyState ?? writeNotifyState;
  const isInteractive = deps.isInteractive ?? (() => Boolean(process.stdin.isTTY));
  const now = deps.now ?? (() => new Date());

  const state = readState();
  if (!isSecondaryOfferEligible(state)) {
    return { outcome: "not_eligible", enabled: { bundle_events: false, weekly: false } };
  }

  // Non-interactive: leave shown=false so the next interactive run still
  // gets the chance to opt in.
  if (process.env.BEHELD_NO_INTERACTIVE === "1" || !isInteractive()) {
    return {
      outcome: "skipped_non_interactive",
      enabled: { bundle_events: false, weekly: false },
    };
  }

  // Prompt — two yes/no questions in sequence. Multi-select would be
  // cleaner but the CLI has no compatible library; sequential y/n keeps
  // the implementation simple and the questions explicit.
  log("");
  log("(opcional) avisar quando algo mudar no perfil?");
  const prompter = deps.prompter ?? nodeReadlinePrompter();

  let optBundleEvents = false;
  let optWeekly = false;
  try {
    const bundleAnswer = await prompter.ask(
      "Notificar quando alguém verificar este snapshot? [y/N] ",
    );
    optBundleEvents = isAffirmative(bundleAnswer);

    const weeklyAnswer = await prompter.ask(
      "Relatório semanal de delta (sem promessa de frequência fixa)? [y/N] ",
    );
    optWeekly = isAffirmative(weeklyAnswer);
  } finally {
    prompter.close();
  }

  // Always mark shown=true. Recusa não retorna.
  if (!optBundleEvents && !optWeekly) {
    writeState({ notify_secondary_offer_shown: true });
    return {
      outcome: "shown_no_opt_in",
      enabled: { bundle_events: false, weekly: false },
    };
  }

  const client = deps.identityClient ?? createIdentityClient({ apiBase: getApiBaseUrl() });
  try {
    await client.patchNotify({
      bundle_events: optBundleEvents,
      weekly: optWeekly,
    });
  } catch (e) {
    warn(`Não foi possível atualizar preferências agora: ${(e as Error).message}.`);
    warn("Tente depois com `beheld notify settings`.");
    // Still mark shown=true — the user gave us an answer, we just couldn't
    // propagate. Re-asking on the next share would be churn for the dev.
    writeState({ notify_secondary_offer_shown: true });
    return {
      outcome: "shown_no_opt_in",
      enabled: { bundle_events: false, weekly: false },
    };
  }

  const baseWeekly = state.notify_weekly ?? {
    enabled: false,
    delta_threshold: 3,
    last_signal_payload: null,
    last_signal_sent_at: null,
    next_signal_at: null,
  };
  const nextSignalAt = optWeekly
    ? new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : baseWeekly.next_signal_at;

  writeState({
    notify_secondary_offer_shown: true,
    notify_consents: {
      security: state.notify_consents?.security ?? true,
      recovery: state.notify_consents?.recovery ?? true,
      bundle_events: optBundleEvents,
      weekly: optWeekly,
    },
    notify_weekly: {
      ...baseWeekly,
      enabled: optWeekly,
      next_signal_at: nextSignalAt,
    },
  });

  log("Preferências atualizadas. Ver estado: `beheld notify status`.");
  return {
    outcome: "shown_opt_in",
    enabled: { bundle_events: optBundleEvents, weekly: optWeekly },
  };
}
