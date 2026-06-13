/**
 * Module 2A — bearer-token-persistence.
 * Tests for the authenticatedFetch wrapper: Bearer injection, proactive
 * expiry refresh, 401 retry, and Unauthenticated when all paths fail.
 *
 * The refresh path is injected (runAuthFlow stub) so the real Ed25519
 * challenge/verify dance is never executed. Network is fully mocked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Unauthenticated,
  authenticatedFetch,
} from "../src/client/authenticated-fetch";
import { AuthFlowError } from "../src/client/auth-flow";
import {
  SESSION_SCHEMA_VERSION,
  readSession,
  writeSession,
  type PersistedSession,
} from "../src/storage/session";

const FAKE_API = "https://api.beheld.test";

let workDir: string;
let beheldDir: string;

function freshSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const now = Date.now();
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    token: "tok-fresh",
    fingerprint: "f".repeat(64),
    api_base: FAKE_API,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

interface FetchCall { url: string; init?: RequestInit }

function buildFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
  calls: FetchCall[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler({ url, init });
  }) as unknown as typeof fetch;
}

/** Stub that simulates a successful refresh, yielding a session with the
 *  caller-specified token. */
function refreshStub(newToken: string) {
  return async () => freshSession({ token: newToken });
}

/** Stub that simulates a refresh that hard-fails (e.g. keys missing). */
function refreshFailingStub() {
  return async () => {
    throw new AuthFlowError("no key", "keystore");
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-authfetch-"));
  beheldDir = join(workDir, ".beheld");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("authenticatedFetch — happy path", () => {
  test("injects Authorization: Bearer <token> from persisted session", async () => {
    writeSession(freshSession({ token: "tok-abc" }), beheldDir);

    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(() => new Response("ok", { status: 200 }), calls);

    await authenticatedFetch(`${FAKE_API}/api/v1/dev/identity/status`, {}, {
      fetch: fetchFn,
      baseDir: beheldDir,
    });

    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-abc");
  });

  test("returns the response as-is on 2xx", async () => {
    writeSession(freshSession(), beheldDir);
    const fetchFn = buildFetch(() => new Response("{\"ok\":true}", { status: 200 }));

    const r = await authenticatedFetch(`${FAKE_API}/x`, {}, { fetch: fetchFn, baseDir: beheldDir });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("{\"ok\":true}");
  });

  test("does not refresh when session is fresh", async () => {
    writeSession(freshSession({ token: "tok-fresh" }), beheldDir);
    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(() => new Response("", { status: 200 }), calls);

    await authenticatedFetch(`${FAKE_API}/x`, {}, {
      fetch: fetchFn,
      baseDir: beheldDir,
      // Refresh stub would explode if invoked.
      runAuthFlow: refreshFailingStub(),
    });
    expect(calls).toHaveLength(1);
    expect(readSession(beheldDir)?.token).toBe("tok-fresh");
  });
});

describe("authenticatedFetch — proactive expiry refresh", () => {
  test("refreshes before sending when stored session is expired", async () => {
    writeSession(
      freshSession({
        token: "tok-stale",
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
      beheldDir,
    );

    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(({ url }) => {
      expect(url).toBe(`${FAKE_API}/x`);
      return new Response("", { status: 200 });
    }, calls);

    const r = await authenticatedFetch(`${FAKE_API}/x`, {}, {
      fetch: fetchFn,
      baseDir: beheldDir,
      runAuthFlow: refreshStub("tok-refreshed"),
    });

    expect(r.status).toBe(200);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-refreshed");
    expect(readSession(beheldDir)?.token).toBe("tok-refreshed");
  });

  test("throws Unauthenticated when no session exists and refresh hard-fails", async () => {
    const fetchFn = buildFetch(() => new Response("", { status: 200 }));
    await expect(
      authenticatedFetch(`${FAKE_API}/x`, {}, {
        fetch: fetchFn,
        baseDir: beheldDir,
        runAuthFlow: refreshFailingStub(),
      }),
    ).rejects.toBeInstanceOf(Unauthenticated);
  });

  test("skipExpiryRefresh sends the stale token without refreshing first", async () => {
    writeSession(
      freshSession({
        token: "tok-stale",
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
      beheldDir,
    );

    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(() => new Response("", { status: 200 }), calls);

    await authenticatedFetch(
      `${FAKE_API}/x`,
      { skipExpiryRefresh: true },
      { fetch: fetchFn, baseDir: beheldDir, runAuthFlow: refreshFailingStub() },
    );

    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-stale");
  });
});

describe("authenticatedFetch — 401 retry", () => {
  test("refreshes once and retries when backend returns 401", async () => {
    writeSession(freshSession({ token: "tok-rejected" }), beheldDir);

    const responses: Response[] = [
      new Response("", { status: 401 }),
      new Response("", { status: 200 }),
    ];
    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(() => responses.shift()!, calls);

    const r = await authenticatedFetch(`${FAKE_API}/x`, {}, {
      fetch: fetchFn,
      baseDir: beheldDir,
      runAuthFlow: refreshStub("tok-renewed"),
    });

    expect(r.status).toBe(200);
    expect(calls.length).toBe(2); // first attempt + retry; refresh is stubbed
    const lastHeaders = new Headers(calls[1].init?.headers);
    expect(lastHeaders.get("Authorization")).toBe("Bearer tok-renewed");
    expect(readSession(beheldDir)?.token).toBe("tok-renewed");
  });

  test("throws Unauthenticated when the retry also returns 401 and clears session", async () => {
    writeSession(freshSession({ token: "tok-permanently-bad" }), beheldDir);

    const responses: Response[] = [
      new Response("", { status: 401 }),
      new Response("", { status: 401 }),
    ];
    const fetchFn = buildFetch(() => responses.shift()!);

    await expect(
      authenticatedFetch(`${FAKE_API}/x`, {}, {
        fetch: fetchFn,
        baseDir: beheldDir,
        runAuthFlow: refreshStub("tok-still-bad"),
      }),
    ).rejects.toBeInstanceOf(Unauthenticated);

    expect(readSession(beheldDir)).toBeNull();
  });

  test("does not refresh on non-401 errors (e.g. 500)", async () => {
    writeSession(freshSession(), beheldDir);
    const calls: FetchCall[] = [];
    const fetchFn = buildFetch(() => new Response("oops", { status: 500 }), calls);

    const r = await authenticatedFetch(`${FAKE_API}/x`, {}, {
      fetch: fetchFn,
      baseDir: beheldDir,
      runAuthFlow: refreshFailingStub(),
    });
    expect(r.status).toBe(500);
    expect(calls).toHaveLength(1);
  });
});

describe("authenticatedFetch — privacy", () => {
  test("the Unauthenticated error does not contain the bearer token", async () => {
    writeSession(freshSession({ token: "super-secret-token-do-not-leak" }), beheldDir);

    const responses: Response[] = [
      new Response("", { status: 401 }),
      new Response("", { status: 401 }),
    ];
    const fetchFn = buildFetch(() => responses.shift()!);

    try {
      await authenticatedFetch(`${FAKE_API}/x`, {}, {
        fetch: fetchFn,
        baseDir: beheldDir,
        runAuthFlow: refreshStub("another-secret-token"),
      });
      throw new Error("should have thrown");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain("super-secret-token-do-not-leak");
      expect(message).not.toContain("another-secret-token");
    }
  });
});
