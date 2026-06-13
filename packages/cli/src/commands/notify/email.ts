/**
 * `beheld notify email <addr> [--purpose=notification|recovery]`
 * `beheld notify email --remove --purpose=<...>`
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import { writeNotifyState, clearNotifyState } from "../../storage/notify";
import {
  EXIT,
  confirm,
  defaultIdentityClient,
  describeError,
  isValidEmail,
} from "./shared";
import type { EmailPurpose, IdentityClient } from "../../client/identity";

export interface NotifyEmailOptions {
  purpose?: string;
  remove?: boolean;
  yes?: boolean;
}

export interface NotifyEmailDeps {
  client?: IdentityClient;
  confirm?: (q: string) => Promise<boolean>;
  log?: (msg: string) => void;
  errLog?: (msg: string) => void;
  exit?: (code: number) => never;
  writeNotifyState?: typeof writeNotifyState;
  clearNotifyState?: typeof clearNotifyState;
}

const VALID_PURPOSES = new Set<EmailPurpose>(["notification", "recovery"]);

export async function notifyEmailCommand(
  address: string | undefined,
  opts: NotifyEmailOptions,
  deps: NotifyEmailDeps = {},
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errLog = deps.errLog ?? ((m) => console.error(m));
  const exit = deps.exit ?? ((c) => process.exit(c) as never);
  const writeState = deps.writeNotifyState ?? writeNotifyState;
  const clearState = deps.clearNotifyState ?? clearNotifyState;
  const promptConfirm = deps.confirm ?? confirm;

  const purpose = (opts.purpose ?? "notification") as EmailPurpose;
  if (!VALID_PURPOSES.has(purpose)) {
    errLog(`Purpose inválido: ${opts.purpose}. Use 'notification' ou 'recovery'.`);
    return exit(EXIT.ARG);
  }

  // ── --remove path ───────────────────────────────────────────────────────
  if (opts.remove) {
    const client = deps.client ?? defaultIdentityClient();
    if (!opts.yes) {
      const proceed = await promptConfirm(
        `Remover email de ${purpose}? [y/N] `,
      );
      if (!proceed) {
        log("Cancelado.");
        return exit(EXIT.OK);
      }
    }
    let removed = false;
    try {
      await client.deleteEmail({ purpose });
      removed = true;
    } catch (err) {
      const { message, code } = describeError(err);
      errLog(message);
      return exit(code);
    }
    if (removed) {
      clearState(purpose);
      log("Email removido.");
      return exit(EXIT.OK);
    }
  }

  // ── create/swap path ────────────────────────────────────────────────────
  if (!address) {
    errLog("Endereço de email obrigatório. Use 'beheld notify email <addr>'.");
    return exit(EXIT.ARG);
  }
  if (!isValidEmail(address)) {
    errLog("Formato de email inválido.");
    return exit(EXIT.ARG);
  }

  const client = deps.client ?? defaultIdentityClient();
  let response: Awaited<ReturnType<IdentityClient["postEmail"]>>;
  try {
    response = await client.postEmail({ email: address, purpose });
  } catch (err) {
    const { message, code } = describeError(err);
    errLog(message);
    return exit(code);
  }

  const key = purpose === "notification" ? "notification_email" : "recovery_email";
  writeState({
    [key]: {
      value: response.email,
      verified: response.verified,
      verified_at: null,
    },
  });
  log(`Email registrado para ${purpose}. Verifique sua caixa de entrada (link expira em 24h).`);
  return exit(EXIT.OK);
}
