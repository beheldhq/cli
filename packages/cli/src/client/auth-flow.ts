/**
 * Reusable challenge/verify flow for obtaining a DevSession bearer token.
 *
 * Module 2A — `cli/bearer-token-persistence`. Extracted from
 * `commands/auth.ts` so any code path (the explicit `beheld auth`, the
 * silent refresh in `authenticatedFetch`, future tooling) shares a single
 * implementation of the cryptographic dance.
 *
 * The flow itself is unchanged from `auth.ts`:
 *   1. POST /api/v1/auth/challenge { fingerprint }     → { nonce }
 *   2. Sign nonce bytes with the local Ed25519 private key.
 *   3. POST /api/v1/auth/verify { fingerprint, nonce, signature }
 *                                                       → { session_token, expires_at }
 *
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import { Buffer } from "node:buffer";

import { getApiBaseUrl } from "../config/env";
import { loadPrivateKey, loadPublicJwk } from "../keys/keystore";

import type { PersistedSession } from "../storage/session";
import { SESSION_SCHEMA_VERSION } from "../storage/session";

export class AuthFlowError extends Error {
  constructor(
    message: string,
    public readonly stage: "challenge" | "verify" | "sign" | "keystore" | "network",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}

/** Test seam — overrides for the network + crypto + key loading. Real
 *  callers leave this empty; tests inject mocks. */
export interface AuthFlowDeps {
  fetch?: typeof fetch;
  loadPublicJwk?: typeof loadPublicJwk;
  loadPrivateKey?: typeof loadPrivateKey;
  apiBase?: string;
  now?: () => Date;
}

interface VerifyResponse {
  session_token: string;
  /** ISO 8601 — set by Rails. Older builds may omit; we fall back to +24h. */
  expires_at?: string;
}

/** Runs the full challenge/verify dance and returns a session ready to be
 *  persisted. Does NOT touch disk — caller composes write. */
export async function runAuthFlow(deps: AuthFlowDeps = {}): Promise<PersistedSession> {
  const fetchImpl = deps.fetch ?? fetch;
  const loadPub   = deps.loadPublicJwk ?? loadPublicJwk;
  const loadPriv  = deps.loadPrivateKey ?? loadPrivateKey;
  const apiBase   = deps.apiBase ?? getApiBaseUrl();
  const now       = (deps.now ?? (() => new Date()));

  let pubJwk;
  try {
    pubJwk = loadPub();
  } catch (e) {
    throw new AuthFlowError(`unable to load public key: ${(e as Error).message}`, "keystore");
  }

  const fingerprint = Buffer.from(pubJwk.x, "base64url").toString("hex");

  let privKey;
  try {
    privKey = await loadPriv();
  } catch (e) {
    throw new AuthFlowError(`unable to load private key: ${(e as Error).message}`, "keystore");
  }

  // 1. Challenge
  let nonce: string;
  try {
    const r = await fetchImpl(`${apiBase}/api/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint }),
    });
    if (!r.ok) {
      throw new AuthFlowError(`challenge HTTP ${r.status}`, "challenge", r.status);
    }
    const data = await r.json() as { nonce: string };
    nonce = data.nonce;
  } catch (e) {
    if (e instanceof AuthFlowError) throw e;
    throw new AuthFlowError(`network: ${(e as Error).message}`, "network");
  }

  // 2. Sign nonce bytes
  let sigHex: string;
  try {
    const nonceBytes = Uint8Array.from(Buffer.from(nonce, "hex"));
    const sigBytes = new Uint8Array(await crypto.subtle.sign("Ed25519", privKey, nonceBytes));
    sigHex = Buffer.from(sigBytes).toString("hex");
  } catch (e) {
    throw new AuthFlowError(`sign: ${(e as Error).message}`, "sign");
  }

  // 3. Verify
  let body: VerifyResponse;
  try {
    const r = await fetchImpl(`${apiBase}/api/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, nonce, signature: sigHex }),
    });
    if (!r.ok) {
      throw new AuthFlowError(`verify HTTP ${r.status}`, "verify", r.status);
    }
    body = await r.json() as VerifyResponse;
  } catch (e) {
    if (e instanceof AuthFlowError) throw e;
    throw new AuthFlowError(`network: ${(e as Error).message}`, "network");
  }

  const createdAt = now();
  const expiresAt = body.expires_at
    ? new Date(body.expires_at)
    : new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    schema_version: SESSION_SCHEMA_VERSION,
    token: body.session_token,
    fingerprint,
    api_base: apiBase,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}
