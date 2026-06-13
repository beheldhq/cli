/**
 * Typed client for `/api/v1/dev/identity/*` (módulo api/identity-email-
 * foundation). All methods go through `authenticatedFetch` from module
 * 2A — Bearer injection + 401 refresh are not this module's concern.
 *
 * Backend shape note (rodada 5): the api/ M1 returns each email record as
 * `{ email, verified, verified_at, link_confirmed, linked_at }`. We carry
 * `link_confirmed` and `linked_at` through to callers because the
 * `notify status` rendering needs them. The original prompt's `{value, …}`
 * shape is out of sync with the deployed shape.
 *
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

import {
  Unauthenticated,
  authenticatedFetch,
  type AuthenticatedFetchDeps,
} from "./authenticated-fetch";

export type EmailPurpose = "notification" | "recovery";
export type SilentWeeksPolicy = "notify" | "skip";

export interface BackendEmailRecord {
  email: string;
  verified: boolean;
  verified_at: string | null;
  link_confirmed: boolean;
  linked_at: string;
}

export interface BackendConsents {
  security: boolean;
  recovery: boolean;
  bundle_events: boolean;
  weekly: boolean;
}

export interface BackendMachine {
  account_id: number;
  fingerprint_truncated: string;
  linked_at: string;
  last_seen_at: string | null;
  is_current: boolean;
}

export interface IdentityStatus {
  notification_email: BackendEmailRecord | null;
  recovery_email: BackendEmailRecord | null;
  consents: BackendConsents;
  delta_threshold: number;
  silent_weeks_policy: SilentWeeksPolicy;
  weekly: {
    last_digest_sent_at: string | null;
    next_digest_expected_at: string | null;
  };
  machines: BackendMachine[];
}

export interface CreateEmailResponse {
  purpose: EmailPurpose;
  email: string;
  verified: boolean;
  token_expires_at: string;
}

export interface CapReachedDetail {
  cap: number;
  accounts: Array<{ fingerprint_truncated: string; linked_at: string }>;
}

export interface NotifyUpdatePayload {
  security?: boolean;
  recovery?: boolean;
  bundle_events?: boolean;
  weekly?: boolean;
  delta_threshold?: number;
  silent_weeks_policy?: SilentWeeksPolicy;
}

/** Error classes — callers branch on `instanceof`. Messages are
 *  stable strings safe to render to the user (no token, no email). */
export class IdentityCapReached extends Error {
  constructor(public readonly detail: CapReachedDetail) {
    super(`identity_cap_reached`);
    this.name = "IdentityCapReached";
  }
}

export class IdentityRateLimited extends Error {
  constructor() {
    super("rate_limited");
    this.name = "IdentityRateLimited";
  }
}

export class IdentityBackendUnreachable extends Error {
  constructor(public override readonly cause?: unknown) {
    super("backend_unreachable");
    this.name = "IdentityBackendUnreachable";
  }
}

export class IdentityValidationError extends Error {
  constructor(public readonly details: string[]) {
    super("validation_failed");
    this.name = "IdentityValidationError";
  }
}

export class IdentityNotFound extends Error {
  constructor() {
    super("not_found");
    this.name = "IdentityNotFound";
  }
}

// Re-export so callers can catch both auth and identity errors from one place.
export { Unauthenticated } from "./authenticated-fetch";

export interface IdentityClient {
  postEmail(p: { email: string; purpose: EmailPurpose }): Promise<CreateEmailResponse>;
  deleteEmail(p: { purpose: EmailPurpose }): Promise<void>;
  patchNotify(p: NotifyUpdatePayload): Promise<unknown>;
  getStatus(): Promise<IdentityStatus>;
  getMachines(): Promise<BackendMachine[]>;
  deleteMachine(p: { account_id: number }): Promise<void>;
}

export interface IdentityClientOptions {
  apiBase: string;
  fetchDeps?: AuthenticatedFetchDeps;
}

/** Factory — keeps DI clean for tests (every dep gets routed into
 *  authenticatedFetch). */
export function createIdentityClient(opts: IdentityClientOptions): IdentityClient {
  const base = opts.apiBase.replace(/\/+$/, "");
  const deps = opts.fetchDeps;

  const send = async <T>(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; body: T | null }> => {
    let r: Response;
    try {
      r = await authenticatedFetch(`${base}${path}`, init, deps);
    } catch (e) {
      if (e instanceof Unauthenticated) throw e;
      throw new IdentityBackendUnreachable(e);
    }
    let body: T | null = null;
    if (r.status !== 204 && r.status !== 410) {
      try {
        const text = await r.text();
        body = text.length === 0 ? null : (JSON.parse(text) as T);
      } catch {
        body = null;
      }
    }
    return { status: r.status, body };
  };

  return {
    async postEmail({ email, purpose }) {
      const { status, body } = await send<CreateEmailResponse & {
        ok?: boolean;
        error?: string;
        cap?: number;
        accounts?: Array<{ fingerprint_truncated: string; linked_at: string }>;
        details?: string[];
      }>("/api/v1/dev/identity/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose }),
      });

      if (status === 201 && body) {
        return {
          purpose: body.purpose,
          email: body.email,
          verified: body.verified,
          token_expires_at: body.token_expires_at,
        };
      }
      if (status === 422 && body?.error === "identity_cap_reached") {
        throw new IdentityCapReached({
          cap: body.cap ?? 3,
          accounts: body.accounts ?? [],
        });
      }
      if (status === 422 && body?.details) {
        throw new IdentityValidationError(body.details);
      }
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },

    async deleteEmail({ purpose }) {
      const { status } = await send<unknown>(
        `/api/v1/dev/identity/emails/${encodeURIComponent(purpose)}`,
        { method: "DELETE" },
      );
      if (status === 204) return;
      if (status === 404) throw new IdentityNotFound();
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },

    async patchNotify(p) {
      const { status, body } = await send<unknown>("/api/v1/dev/identity/notify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (status === 200) return body;
      if (status === 422) {
        const detail = body as { details?: string[] } | null;
        throw new IdentityValidationError(detail?.details ?? []);
      }
      if (status === 400) throw new IdentityValidationError(["bad_request"]);
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },

    async getStatus() {
      const { status, body } = await send<IdentityStatus>(
        "/api/v1/dev/identity/status",
        { method: "GET" },
      );
      if (status === 200 && body) return body;
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },

    async getMachines() {
      const { status, body } = await send<{ ok: boolean; machines: BackendMachine[] }>(
        "/api/v1/dev/identity/machines",
        { method: "GET" },
      );
      if (status === 200 && body) return body.machines;
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },

    async deleteMachine({ account_id }) {
      const { status } = await send<unknown>(
        `/api/v1/dev/identity/machines/${account_id}`,
        { method: "DELETE" },
      );
      if (status === 204) return;
      if (status === 404) throw new IdentityNotFound();
      if (status === 422) throw new IdentityValidationError(["cannot_unlink_self_via_machines_endpoint"]);
      if (status === 429) throw new IdentityRateLimited();
      throw new IdentityBackendUnreachable(`unexpected status ${status}`);
    },
  };
}
