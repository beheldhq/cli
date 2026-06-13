/**
 * Shared helpers for `beheld notify *` subcommands.
 *
 * Module 2 of 6 — `cli/notify-commands`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import { createInterface } from "node:readline";

import { getApiBaseUrl } from "../../config/env";
import {
  IdentityBackendUnreachable,
  IdentityCapReached,
  IdentityNotFound,
  IdentityRateLimited,
  IdentityValidationError,
  Unauthenticated,
  createIdentityClient,
  type IdentityClient,
} from "../../client/identity";

/** Exit codes — spec D3. */
export const EXIT = {
  OK: 0,
  ARG: 2,
  CAP: 3,
  BACKEND: 4,
  SESSION: 5,
} as const;

/** Real client. Tests inject their own via the *Deps APIs. */
export function defaultIdentityClient(): IdentityClient {
  return createIdentityClient({ apiBase: getApiBaseUrl() });
}

/** Reads y/N from stdin. Default no. */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "y");
    });
  });
}

/** Maps a thrown IdentityClient error to (printable message, exit code). */
export function describeError(err: unknown): { message: string; code: number } {
  if (err instanceof IdentityCapReached) {
    const lines = ["Limite de máquinas atingido para esse email.", "Máquinas atualmente vinculadas:"];
    for (const a of err.detail.accounts) {
      lines.push(`  - ${a.fingerprint_truncated}  vinculada em ${formatDate(a.linked_at)}`);
    }
    lines.push(
      `Limite: ${err.detail.cap}. Para liberar uma vaga, rode \`beheld notify machines --unlink <fingerprint>\`.`,
    );
    return { message: lines.join("\n"), code: EXIT.CAP };
  }
  if (err instanceof IdentityRateLimited) {
    return {
      message: "Limite de requisições atingido. Tente novamente em alguns instantes.",
      code: EXIT.BACKEND,
    };
  }
  if (err instanceof IdentityBackendUnreachable) {
    return {
      message: "Backend inacessível. Tente novamente em alguns instantes.",
      code: EXIT.BACKEND,
    };
  }
  if (err instanceof Unauthenticated) {
    return {
      message: "Sessão expirada e não foi possível renovar. Rode `beheld auth`.",
      code: EXIT.SESSION,
    };
  }
  if (err instanceof IdentityValidationError) {
    const detail = err.details.length > 0 ? `: ${err.details.join("; ")}` : "";
    return { message: `Dados inválidos${detail}.`, code: EXIT.ARG };
  }
  if (err instanceof IdentityNotFound) {
    return { message: "Recurso não encontrado.", code: EXIT.BACKEND };
  }
  return {
    message: `Erro inesperado: ${(err as Error).message ?? String(err)}`,
    code: EXIT.BACKEND,
  };
}

/** Lightweight format helper for dates (ISO → "12/jun 14:32"). */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate().toString().padStart(2, "0");
  const months = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const month = months[d.getUTCMonth()];
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${day}/${month} ${hh}:${mm}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

/** Maps a CLI on/off flag to boolean. Returns undefined for absent. */
export function onOff(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1" || v === "yes") return true;
  if (v === "off" || v === "false" || v === "0" || v === "no") return false;
  return undefined;
}
