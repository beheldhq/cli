/**
 * Module 2 — notify-commands. Tests for client/identity.ts (IdentityClient).
 *
 * Network is mocked at the `authenticatedFetch` layer via runAuthFlow stub.
 * The session.json is pre-seeded with a fresh token so authenticatedFetch
 * never tries to actually refresh.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  IdentityBackendUnreachable,
  IdentityCapReached,
  IdentityNotFound,
  IdentityRateLimited,
  IdentityValidationError,
  createIdentityClient,
} from "../src/client/identity";
import {
  SESSION_SCHEMA_VERSION,
  writeSession,
  type PersistedSession,
} from "../src/storage/session";

const FAKE_API = "https://api.beheld.test";

let workDir: string;
let beheldDir: string;

interface FetchCall { url: string; init?: RequestInit }

function buildFetch(
  responses: Array<Response | ((call: FetchCall) => Response | Promise<Response>)>,
  calls: FetchCall[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) return new Response("", { status: 500 });
    return typeof next === "function" ? next({ url, init }) : next;
  }) as unknown as typeof fetch;
}

function freshSession(): PersistedSession {
  const now = Date.now();
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    token: "tok-fresh",
    fingerprint: "f".repeat(64),
    api_base: FAKE_API,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-identity-client-"));
  beheldDir = join(workDir, ".beheld");
  writeSession(freshSession(), beheldDir);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function buildClient(responses: Array<Response | ((c: FetchCall) => Response)>, calls: FetchCall[] = []) {
  const fetchFn = buildFetch(responses, calls);
  return createIdentityClient({
    apiBase: FAKE_API,
    fetchDeps: { fetch: fetchFn, baseDir: beheldDir },
  });
}

describe("postEmail", () => {
  test("201 returns parsed body", async () => {
    const calls: FetchCall[] = [];
    const client = buildClient(
      [new Response(JSON.stringify({
        ok: true,
        purpose: "notification",
        email: "a@b.test",
        verified: false,
        token_expires_at: "2026-06-13T10:00:00Z",
      }), { status: 201 })],
      calls,
    );

    const r = await client.postEmail({ email: "a@b.test", purpose: "notification" });
    expect(r.email).toBe("a@b.test");
    expect(r.purpose).toBe("notification");

    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-fresh");
    expect(calls[0].url).toBe(`${FAKE_API}/api/v1/dev/identity/emails`);
  });

  test("422 with identity_cap_reached throws IdentityCapReached carrying accounts", async () => {
    const client = buildClient([
      new Response(JSON.stringify({
        ok: false,
        error: "identity_cap_reached",
        cap: 3,
        accounts: [
          { fingerprint_truncated: "aaaa1111", linked_at: "2026-06-10T10:00:00Z" },
          { fingerprint_truncated: "bbbb2222", linked_at: "2026-06-11T10:00:00Z" },
          { fingerprint_truncated: "cccc3333", linked_at: "2026-06-12T10:00:00Z" },
        ],
      }), { status: 422 }),
    ]);

    await expect(
      client.postEmail({ email: "a@b.test", purpose: "notification" }),
    ).rejects.toBeInstanceOf(IdentityCapReached);
  });

  test("429 throws IdentityRateLimited", async () => {
    const client = buildClient([new Response("", { status: 429 })]);
    await expect(client.postEmail({ email: "a@b.test", purpose: "notification" }))
      .rejects.toBeInstanceOf(IdentityRateLimited);
  });

  test("400 on bad backend status throws IdentityBackendUnreachable", async () => {
    const client = buildClient([new Response("", { status: 503 })]);
    await expect(client.postEmail({ email: "a@b.test", purpose: "notification" }))
      .rejects.toBeInstanceOf(IdentityBackendUnreachable);
  });
});

describe("deleteEmail", () => {
  test("204 resolves void", async () => {
    const client = buildClient([new Response("", { status: 204 })]);
    await expect(client.deleteEmail({ purpose: "notification" })).resolves.toBeUndefined();
  });

  test("404 throws IdentityNotFound", async () => {
    const client = buildClient([new Response("", { status: 404 })]);
    await expect(client.deleteEmail({ purpose: "notification" }))
      .rejects.toBeInstanceOf(IdentityNotFound);
  });

  test("uses path with purpose segment", async () => {
    const calls: FetchCall[] = [];
    const client = buildClient([new Response("", { status: 204 })], calls);
    await client.deleteEmail({ purpose: "recovery" });
    expect(calls[0].url).toBe(`${FAKE_API}/api/v1/dev/identity/emails/recovery`);
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("patchNotify", () => {
  test("200 resolves and sends PATCH with json body", async () => {
    const calls: FetchCall[] = [];
    const client = buildClient([new Response(JSON.stringify({ ok: true }), { status: 200 })], calls);
    await client.patchNotify({ weekly: true, delta_threshold: 5 });
    expect(calls[0].init?.method).toBe("PATCH");
    const sentBody = JSON.parse(calls[0].init?.body as string);
    expect(sentBody.weekly).toBe(true);
    expect(sentBody.delta_threshold).toBe(5);
  });

  test("422 throws IdentityValidationError with details", async () => {
    const client = buildClient([new Response(JSON.stringify({
      ok: false, error: "validation_failed", details: ["delta_threshold must be 1..50"],
    }), { status: 422 })]);
    await expect(client.patchNotify({ delta_threshold: 99 }))
      .rejects.toBeInstanceOf(IdentityValidationError);
  });

  test("400 throws IdentityValidationError", async () => {
    const client = buildClient([new Response("", { status: 400 })]);
    await expect(client.patchNotify({}))
      .rejects.toBeInstanceOf(IdentityValidationError);
  });
});

describe("getStatus", () => {
  test("returns parsed status shape", async () => {
    const sample = {
      notification_email: {
        email: "a@b.test",
        verified: true,
        verified_at: "2026-06-12T10:00:00Z",
        link_confirmed: true,
        linked_at: "2026-06-10T10:00:00Z",
      },
      recovery_email: null,
      consents: { security: true, recovery: true, bundle_events: false, weekly: false },
      delta_threshold: 3,
      silent_weeks_policy: "notify",
      weekly: { last_digest_sent_at: null, next_digest_expected_at: null },
      machines: [],
    };
    const client = buildClient([new Response(JSON.stringify(sample), { status: 200 })]);
    const status = await client.getStatus();
    expect(status.notification_email?.email).toBe("a@b.test");
    expect(status.consents.security).toBe(true);
  });
});

describe("getMachines and deleteMachine", () => {
  test("getMachines parses machines array", async () => {
    const client = buildClient([new Response(JSON.stringify({
      ok: true,
      machines: [
        { account_id: 1, fingerprint_truncated: "aaaa1111", linked_at: "2026-06-10T10:00:00Z", last_seen_at: null, is_current: true },
        { account_id: 2, fingerprint_truncated: "bbbb2222", linked_at: "2026-06-11T10:00:00Z", last_seen_at: null, is_current: false },
      ],
    }), { status: 200 })]);

    const machines = await client.getMachines();
    expect(machines).toHaveLength(2);
    expect(machines[0].is_current).toBe(true);
  });

  test("deleteMachine with 422 surfaces IdentityValidationError (self-unlink guard)", async () => {
    const client = buildClient([new Response("", { status: 422 })]);
    await expect(client.deleteMachine({ account_id: 99 }))
      .rejects.toBeInstanceOf(IdentityValidationError);
  });

  test("deleteMachine uses path with account_id", async () => {
    const calls: FetchCall[] = [];
    const client = buildClient([new Response("", { status: 204 })], calls);
    await client.deleteMachine({ account_id: 42 });
    expect(calls[0].url).toBe(`${FAKE_API}/api/v1/dev/identity/machines/42`);
    expect(calls[0].init?.method).toBe("DELETE");
  });
});
