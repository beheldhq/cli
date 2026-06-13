/**
 * `beheld notify status [--json]`
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import { writeNotifyState } from "../../storage/notify";
import { EXIT, defaultIdentityClient, describeError, formatDate } from "./shared";
import type { IdentityClient, IdentityStatus } from "../../client/identity";

export interface NotifyStatusOptions {
  json?: boolean;
}

export interface NotifyStatusDeps {
  client?: IdentityClient;
  log?: (msg: string) => void;
  errLog?: (msg: string) => void;
  exit?: (code: number) => never;
  writeNotifyState?: typeof writeNotifyState;
}

export async function notifyStatusCommand(
  opts: NotifyStatusOptions,
  deps: NotifyStatusDeps = {},
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errLog = deps.errLog ?? ((m) => console.error(m));
  const exit = deps.exit ?? ((c) => process.exit(c) as never);
  const writeState = deps.writeNotifyState ?? writeNotifyState;
  const client = deps.client ?? defaultIdentityClient();

  let status: IdentityStatus;
  try {
    status = await client.getStatus();
  } catch (err) {
    const { message, code } = describeError(err);
    errLog(message);
    return exit(code);
  }

  // Reconcile local cache with backend.
  writeState({
    notification_email: status.notification_email
      ? {
          value: status.notification_email.email,
          verified: status.notification_email.verified,
          verified_at: status.notification_email.verified_at,
        }
      : undefined,
    recovery_email: status.recovery_email
      ? {
          value: status.recovery_email.email,
          verified: status.recovery_email.verified,
          verified_at: status.recovery_email.verified_at,
        }
      : undefined,
    notify_consents: status.consents,
    notify_silent_weeks_policy: status.silent_weeks_policy,
  });

  if (opts.json) {
    log(JSON.stringify(status, null, 2));
    return exit(EXIT.OK);
  }

  log(renderText(status));
  return exit(EXIT.OK);
}

export function renderText(s: IdentityStatus): string {
  const lines: string[] = [];

  const notif = s.notification_email;
  if (notif) {
    const tag = notif.verified
      ? `verificado em ${formatDate(notif.verified_at)}`
      : "(não verificado)";
    lines.push(`Email de notificação: ${notif.email} (${tag})`);
  } else {
    lines.push("Email de notificação: (não configurado)");
  }

  const rec = s.recovery_email;
  if (rec) {
    const tag = rec.verified
      ? `verificado em ${formatDate(rec.verified_at)}`
      : "(não verificado)";
    lines.push(`Email de recovery:    ${rec.email} (${tag})`);
  } else {
    lines.push("Email de recovery:    (não configurado)");
  }

  lines.push("Consentimentos ativos:");
  lines.push(`  [${s.consents.security      ? "x" : " "}] segurança       (alertas críticos)`);
  lines.push(`  [${s.consents.recovery      ? "x" : " "}] recovery        (re-vinculação de identidade)`);
  lines.push(`  [${s.consents.bundle_events ? "x" : " "}] bundle events   (verificação por terceiros)`);
  lines.push(`  [${s.consents.weekly        ? "x" : " "}] weekly digest   (relatório semanal de delta)`);

  lines.push(`Threshold de delta: ${s.delta_threshold}`);
  lines.push(`Política de semanas sem delta: ${s.silent_weeks_policy}`);

  lines.push(
    `Próximo digest esperado: ${s.weekly.next_digest_expected_at ? formatDate(s.weekly.next_digest_expected_at) : "(não agendado)"}`,
  );
  lines.push(
    `Último digest enviado:    ${s.weekly.last_digest_sent_at ? formatDate(s.weekly.last_digest_sent_at) : "(nunca)"}`,
  );

  if (s.machines.length === 0) {
    lines.push("Máquinas vinculadas: (nenhuma)");
  } else {
    lines.push("Máquinas vinculadas (mesma conta de notificação):");
    for (const m of s.machines) {
      const marker = m.is_current ? "→ este dispositivo" : "·";
      lines.push(`  ${marker}  fingerprint ${m.fingerprint_truncated}  vinculado em ${formatDate(m.linked_at)}`);
    }
  }

  return lines.join("\n");
}
