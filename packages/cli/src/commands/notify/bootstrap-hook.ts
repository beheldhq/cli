/**
 * Bootstrap-time email opt-in. Adds a single optional prompt at the end of
 * `beheld bootstrap` asking for a notification email. If the user provides
 * one, the CLI runs the Ed25519 challenge/verify dance lazily (M2A) and
 * registers the email via M2's IdentityClient.
 *
 * Module 3 of 6 — `cli/bootstrap-and-share-prompts`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 *
 * Tom: testemunha, opt-in passivo, sem CTA exclamativo.
 * Failure non-blocking: bootstrap completes even if the email step fails.
 */

import { runAuthFlow } from "../../client/auth-flow";
import {
  createIdentityClient,
  type IdentityClient,
} from "../../client/identity";
import { getApiBaseUrl } from "../../config/env";
import { writeSession } from "../../storage/session";
import { readNotifyState, writeNotifyState } from "../../storage/notify";
import {
  isAffirmative,
  nodeReadlinePrompter,
  type Prompter,
} from "../share";
import { isValidEmail } from "./shared";

export type RunAuthFlowFn = typeof runAuthFlow;

export interface BootstrapNotifyHookOptions {
  /** Skip the prompt regardless of TTY state. CLI flag `--no-interactive`
   *  and env `BEHELD_NO_INTERACTIVE=1` both map here. */
  noInteractive?: boolean;
}

export interface BootstrapNotifyHookDeps {
  prompter?: Prompter;
  identityClient?: IdentityClient;
  runAuthFlow?: RunAuthFlowFn;
  /** Override TTY detection — tests inject false to force the skip path. */
  isInteractive?: () => boolean;
  /** Reads/writes notify_* keys. Defaults to the M2 helpers. */
  readNotifyState?: typeof readNotifyState;
  writeNotifyState?: typeof writeNotifyState;
  /** Persists the freshly-minted bearer (M2A). */
  writeSession?: typeof writeSession;
  /** Override stdout/stderr — bootstrap.ts uses its own logger; we follow. */
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

/** Outcome of running the hook. Surfaced for tests and for the parent
 *  bootstrap command to include in its summary. */
export interface BootstrapNotifyHookResult {
  /** True when we showed the prompt at all (false in non-interactive). */
  prompted: boolean;
  /** "skipped"  — user pressed Enter, or non-interactive, or already configured.
   *  "registered" — backend accepted the email; verification pending.
   *  "auth_failed" — the Ed25519 dance hit a snag; we logged and moved on.
   *  "backend_failed" — backend refused the POST; we logged and moved on. */
  outcome: "skipped" | "registered" | "auth_failed" | "backend_failed";
}

export async function runBootstrapNotifyHook(
  opts: BootstrapNotifyHookOptions = {},
  deps: BootstrapNotifyHookDeps = {},
): Promise<BootstrapNotifyHookResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const readState = deps.readNotifyState ?? readNotifyState;
  const writeState = deps.writeNotifyState ?? writeNotifyState;
  const writeSess = deps.writeSession ?? writeSession;
  const runFlow = deps.runAuthFlow ?? runAuthFlow;
  const isInteractive = deps.isInteractive ?? (() => Boolean(process.stdin.isTTY));

  // 1. Idempotent — never re-prompt once the channel is configured.
  const existing = readState();
  if (existing.notification_email) return { prompted: false, outcome: "skipped" };

  // 2. Non-interactive contexts (CI, piped, explicit flag) skip silently.
  if (opts.noInteractive) return { prompted: false, outcome: "skipped" };
  if (process.env.BEHELD_NO_INTERACTIVE === "1") return { prompted: false, outcome: "skipped" };
  if (!isInteractive()) return { prompted: false, outcome: "skipped" };

  // 3. Prompt. Tone: opt-in passivo, sem CTA exclamativo.
  log("");
  log("(opcional) email para alertas de segurança e notificações");
  log("Você pode adicionar depois com `beheld notify email`. [Enter para pular]");
  const prompter = deps.prompter ?? nodeReadlinePrompter();
  let email = "";
  try {
    email = (await prompter.ask("Email: ")).trim();
  } finally {
    prompter.close();
  }
  if (email.length === 0) {
    return { prompted: true, outcome: "skipped" };
  }
  if (!isValidEmail(email)) {
    warn("Formato de email inválido. Continuando sem registrar.");
    return { prompted: true, outcome: "skipped" };
  }

  // 4. Lazy bearer: bootstrap does not maintain a long-lived session, so we
  //    run the Ed25519 challenge/verify dance only when we have a real
  //    reason to (the user just typed an email). Token is persisted to
  //    ~/.beheld/session.json (M2A) so future commands inherit it.
  let session;
  try {
    session = await runFlow();
    writeSess(session);
  } catch (e) {
    warn(`Não foi possível autenticar para registrar o email: ${(e as Error).message}.`);
    warn("Tente depois com `beheld notify email`.");
    return { prompted: true, outcome: "auth_failed" };
  }

  // 5. POST /dev/identity/emails — purpose=notification. The user opted into
  //    a single channel; granular consents land with the analysis defaults
  //    (security/recovery on, bundle_events/weekly off — round-5 decision).
  const client = deps.identityClient ?? createIdentityClient({ apiBase: getApiBaseUrl() });
  try {
    const response = await client.postEmail({ email, purpose: "notification" });
    writeState({
      notification_email: {
        value: response.email,
        verified: false,
        verified_at: null,
      },
      notify_consents: {
        security: true,
        recovery: true,
        bundle_events: false,
        weekly: false,
      },
      notify_silent_weeks_policy: "notify",
      notify_secondary_offer_shown: false,
    });
    log("");
    log(`Email registrado para verificação. O link expira em 24h.`);
    return { prompted: true, outcome: "registered" };
  } catch (e) {
    warn(`Não foi possível registrar o email agora: ${(e as Error).message}.`);
    warn("Tente depois com `beheld notify email`.");
    return { prompted: true, outcome: "backend_failed" };
  }
}
