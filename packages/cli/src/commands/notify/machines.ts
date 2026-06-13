/**
 * `beheld notify machines [--unlink <fingerprint_short>]`
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import {
  EXIT,
  confirm,
  defaultIdentityClient,
  describeError,
  formatDate,
} from "./shared";
import type { BackendMachine, IdentityClient } from "../../client/identity";

export interface NotifyMachinesOptions {
  unlink?: string;
  yes?: boolean;
  json?: boolean;
}

export interface NotifyMachinesDeps {
  client?: IdentityClient;
  confirm?: (q: string) => Promise<boolean>;
  log?: (msg: string) => void;
  errLog?: (msg: string) => void;
  exit?: (code: number) => never;
}

export async function notifyMachinesCommand(
  opts: NotifyMachinesOptions,
  deps: NotifyMachinesDeps = {},
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errLog = deps.errLog ?? ((m) => console.error(m));
  const exit = deps.exit ?? ((c) => process.exit(c) as never);
  const client = deps.client ?? defaultIdentityClient();
  const promptConfirm = deps.confirm ?? confirm;

  let machines: BackendMachine[];
  try {
    machines = await client.getMachines();
  } catch (err) {
    const { message, code } = describeError(err);
    errLog(message);
    return exit(code);
  }

  if (!opts.unlink) {
    log(opts.json ? JSON.stringify(machines, null, 2) : renderList(machines));
    return exit(EXIT.OK);
  }

  // --unlink path
  const target = machines.find((m) => m.fingerprint_truncated === opts.unlink);
  if (!target) {
    errLog(`Máquina ${opts.unlink} não encontrada entre as vinculadas.`);
    return exit(EXIT.ARG);
  }
  if (target.is_current) {
    errLog(
      "Não é possível desvincular este dispositivo por aqui. Use 'beheld notify email --remove --purpose=notification' para desvincular o atual.",
    );
    return exit(EXIT.ARG);
  }

  if (!opts.yes) {
    const proceed = await promptConfirm(
      `Desvincular máquina ${target.fingerprint_truncated} (vinculada em ${formatDate(target.linked_at)})? [y/N] `,
    );
    if (!proceed) {
      log("Cancelado.");
      return exit(EXIT.OK);
    }
  }

  try {
    await client.deleteMachine({ account_id: target.account_id });
  } catch (err) {
    const { message, code } = describeError(err);
    errLog(message);
    return exit(code);
  }
  log("Máquina desvinculada.");
  return exit(EXIT.OK);
}

function renderList(machines: BackendMachine[]): string {
  if (machines.length === 0) {
    return "Nenhuma máquina vinculada a este email de notificação.";
  }
  const lines = ["Máquinas vinculadas (mesma conta de notificação):"];
  for (const m of machines) {
    const marker = m.is_current ? "→ este dispositivo" : "·";
    const seen = m.last_seen_at ? `· última atividade ${formatDate(m.last_seen_at)}` : "";
    lines.push(`  ${marker}  ${m.fingerprint_truncated}  vinculada em ${formatDate(m.linked_at)} ${seen}`.trimEnd());
  }
  return lines.join("\n");
}
