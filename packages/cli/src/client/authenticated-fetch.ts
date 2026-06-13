/**
 * `authenticatedFetch` — fetch wrapper that injects the persisted DevSession
 * bearer token, transparently refreshes it on 401, and surfaces a clean
 * `Unauthenticated` for callers that need to react.
 *
 * Module 2A — `cli/bearer-token-persistence`. Foundation for any
 * authenticated CLI feature talking to the portal API.
 *
 * Refresh policy:
 *   - If the on-disk session is missing or `expires_at` is in the past,
 *     refresh BEFORE sending the request.
 *   - If the backend returns 401, refresh once and retry the same request.
 *   - A second 401 (after refresh) bubbles as `Unauthenticated`. The caller
 *     should prompt the user to run `beheld auth` and abort.
 *
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import {
  runAuthFlow as defaultRunAuthFlow,
  AuthFlowError,
  type AuthFlowDeps,
} from "./auth-flow";
import {
  clearSession,
  isSessionExpired,
  readSession,
  writeSession,
  type PersistedSession,
} from "../storage/session";

/** Type alias so tests can stub the refresh path without importing the real
 *  challenge/verify dance (which would need a real Ed25519 keypair). */
export type RunAuthFlow = (deps?: AuthFlowDeps) => Promise<PersistedSession>;

export class Unauthenticated extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "Unauthenticated";
  }
}

export interface AuthenticatedFetchDeps {
  /** Override the network — tests stub this. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Override session storage location (tests use a tmpdir). */
  baseDir?: string;
  /** Forwarded to `runAuthFlow` when a refresh is needed. */
  authFlowDeps?: AuthFlowDeps;
  /** Override clock for expiration checks. */
  now?: () => Date;
  /** Override the refresh implementation — used by tests to avoid invoking
   *  the real Ed25519-based challenge/verify dance. */
  runAuthFlow?: RunAuthFlow;
}

export interface AuthenticatedFetchOptions extends RequestInit {
  /** Skip the proactive expiry check (still retries on 401). Useful when
   *  the caller knows the token was just refreshed. */
  skipExpiryRefresh?: boolean;
}

/** Returns a `Response`. Throws `Unauthenticated` if the user has no usable
 *  credential and cannot refresh — i.e. keys missing or the portal refused
 *  the refresh challenge. Other HTTP statuses are returned as-is. */
export async function authenticatedFetch(
  url: string,
  init: AuthenticatedFetchOptions = {},
  deps: AuthenticatedFetchDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetch ?? fetch;
  const baseDir   = deps.baseDir;
  const now       = deps.now ?? (() => new Date());

  let session = readSession(baseDir);

  // Proactive refresh if local clock thinks the token is dead.
  if (!init.skipExpiryRefresh && isSessionExpired(session, now())) {
    session = await refreshAndPersist(baseDir, deps);
  }

  if (!session) {
    throw new Unauthenticated("no usable session — run `beheld auth` first");
  }

  const firstAttempt = await doFetch(fetchImpl, url, init, session.token);
  if (firstAttempt.status !== 401) return firstAttempt;

  // Drain body if any (best-effort — we don't surface this response to the
  // caller, so leaving the stream pending would leak.)
  try { await firstAttempt.arrayBuffer(); } catch { /* noop */ }

  // 401 → refresh once and retry.
  let refreshed: PersistedSession;
  try {
    refreshed = await refreshAndPersist(baseDir, deps);
  } catch (e) {
    throw new Unauthenticated("session refresh failed", e);
  }

  const retry = await doFetch(fetchImpl, url, init, refreshed.token);
  if (retry.status !== 401) return retry;

  // Two strikes — give up. Wipe the disk copy so future invocations are
  // honest about the state.
  clearSession(baseDir);
  throw new Unauthenticated("portal rejected refreshed session");
}

async function doFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: AuthenticatedFetchOptions,
  token: string,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  // Pass through only the standard RequestInit fields; strip our custom one.
  const { skipExpiryRefresh: _drop, ...rest } = init;
  return fetchImpl(url, { ...rest, headers });
}

async function refreshAndPersist(
  baseDir: string | undefined,
  deps: AuthenticatedFetchDeps,
): Promise<PersistedSession> {
  const refresh = deps.runAuthFlow ?? defaultRunAuthFlow;
  try {
    const fresh = await refresh(deps.authFlowDeps);
    writeSession(fresh, baseDir);
    return fresh;
  } catch (e) {
    if (e instanceof AuthFlowError) {
      throw new Unauthenticated(`refresh failed: ${e.stage}${e.status ? ` (${e.status})` : ""}`, e);
    }
    throw new Unauthenticated(`refresh failed: ${(e as Error).message}`, e);
  }
}
