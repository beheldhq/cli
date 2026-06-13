/**
 * Module 3 — bootstrap-and-share-prompts. Tests for the bootstrap-time
 * email opt-in prompt.
 */
import { describe, expect, test } from "bun:test";

import {
  runBootstrapNotifyHook,
  type BootstrapNotifyHookDeps,
} from "../../src/commands/notify/bootstrap-hook";
import type {
  CreateEmailResponse,
  IdentityClient,
} from "../../src/client/identity";
import type { NotifyState } from "../../src/storage/notify";
import type { PersistedSession } from "../../src/storage/session";

function stubClient(opts: { postEmail?: () => Promise<CreateEmailResponse> } = {}): IdentityClient {
  return {
    postEmail: opts.postEmail ?? (async () => ({
      purpose: "notification",
      email: "dev@example.test",
      verified: false,
      token_expires_at: "2026-06-14T10:00:00Z",
    })),
    deleteEmail: async () => undefined,
    patchNotify: async () => ({}),
    getStatus: async () => { throw new Error("not used"); },
    getMachines: async () => [],
    deleteMachine: async () => undefined,
  };
}

function stubPrompter(answer: string) {
  let closed = false;
  return {
    prompter: {
      ask: async () => answer,
      close: () => { closed = true; },
    },
    isClosed: () => closed,
  };
}

function fakeSession(): PersistedSession {
  return {
    schema_version: 1,
    token: "tok-fresh",
    fingerprint: "f".repeat(64),
    api_base: "https://api.beheld.test",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function buildDeps(overrides: Partial<BootstrapNotifyHookDeps> = {}): {
  deps: BootstrapNotifyHookDeps;
  logs: string[];
  warns: string[];
  writes: NotifyState[];
} {
  const logs: string[] = [];
  const warns: string[] = [];
  const writes: NotifyState[] = [];
  return {
    deps: {
      log: (l) => logs.push(l),
      warn: (l) => warns.push(l),
      readNotifyState: () => ({}),
      writeNotifyState: ((patch) => { writes.push(patch as NotifyState); return {}; }) as never,
      writeSession: (() => {}) as never,
      runAuthFlow: async () => fakeSession(),
      isInteractive: () => true,
      identityClient: stubClient(),
      ...overrides,
    },
    logs, warns, writes,
  };
}

describe("runBootstrapNotifyHook — skip paths", () => {
  test("idempotent: skips when notification_email already exists", async () => {
    const { deps } = buildDeps({
      readNotifyState: () => ({
        notification_email: { value: "a@b.test", verified: false, verified_at: null },
      }),
    });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result).toEqual({ prompted: false, outcome: "skipped" });
  });

  test("non-interactive option skips silently", async () => {
    const { deps } = buildDeps({ isInteractive: () => true });
    const result = await runBootstrapNotifyHook({ noInteractive: true }, deps);
    expect(result.prompted).toBe(false);
  });

  test("BEHELD_NO_INTERACTIVE=1 skips silently", async () => {
    const old = process.env.BEHELD_NO_INTERACTIVE;
    process.env.BEHELD_NO_INTERACTIVE = "1";
    try {
      const { deps } = buildDeps({ isInteractive: () => true });
      const result = await runBootstrapNotifyHook({}, deps);
      expect(result.prompted).toBe(false);
    } finally {
      if (old === undefined) delete process.env.BEHELD_NO_INTERACTIVE;
      else process.env.BEHELD_NO_INTERACTIVE = old;
    }
  });

  test("TTY absent skips silently", async () => {
    const { deps } = buildDeps({ isInteractive: () => false });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result.prompted).toBe(false);
  });
});

describe("runBootstrapNotifyHook — prompt paths", () => {
  test("Enter (empty) skips without calling backend", async () => {
    const promptStub = stubPrompter("");
    let postCalled = false;
    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({
        postEmail: async () => { postCalled = true; return {} as CreateEmailResponse; },
      }),
    });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result).toEqual({ prompted: true, outcome: "skipped" });
    expect(postCalled).toBe(false);
    expect(writes).toHaveLength(0);
    expect(promptStub.isClosed()).toBe(true);
  });

  test("malformed email warns and skips", async () => {
    const promptStub = stubPrompter("not-an-email");
    const { deps, warns, writes } = buildDeps({ prompter: promptStub.prompter });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result.outcome).toBe("skipped");
    expect(warns.some((l) => l.includes("inválido"))).toBe(true);
    expect(writes).toHaveLength(0);
  });

  test("happy path: email → runAuthFlow → postEmail → writes state with defaults", async () => {
    const promptStub = stubPrompter("dev@example.test");
    let authRan = false;
    let postEmailArgs: { email: string; purpose: string } | null = null;
    let sessionPersisted = false;

    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      runAuthFlow: async () => { authRan = true; return fakeSession(); },
      writeSession: (() => { sessionPersisted = true; }) as never,
      identityClient: stubClient({
        postEmail: async (p) => {
          postEmailArgs = p;
          return {
            purpose: "notification",
            email: "dev@example.test",
            verified: false,
            token_expires_at: "2026-06-14T10:00:00Z",
          };
        },
      }),
    });

    const result = await runBootstrapNotifyHook({}, deps);

    expect(result).toEqual({ prompted: true, outcome: "registered" });
    expect(authRan).toBe(true);
    expect(sessionPersisted).toBe(true);
    expect(postEmailArgs).toEqual({ email: "dev@example.test", purpose: "notification" });

    expect(writes).toHaveLength(1);
    const wrote = writes[0];
    expect(wrote.notification_email).toEqual({
      value: "dev@example.test",
      verified: false,
      verified_at: null,
    });
    expect(wrote.notify_consents).toEqual({
      security: true,
      recovery: true,
      bundle_events: false,
      weekly: false,
    });
    expect(wrote.notify_silent_weeks_policy).toBe("notify");
    expect(wrote.notify_secondary_offer_shown).toBe(false);
  });

  test("auth flow failure does not block bootstrap (warn + outcome=auth_failed)", async () => {
    const promptStub = stubPrompter("dev@example.test");
    const { deps, warns, writes } = buildDeps({
      prompter: promptStub.prompter,
      runAuthFlow: async () => { throw new Error("keys missing"); },
    });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result.outcome).toBe("auth_failed");
    expect(warns.length).toBeGreaterThan(0);
    expect(writes).toHaveLength(0);
  });

  test("postEmail failure does not block bootstrap (warn + outcome=backend_failed)", async () => {
    const promptStub = stubPrompter("dev@example.test");
    const { deps, warns, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({
        postEmail: async () => { throw new Error("backend exploded"); },
      }),
    });
    const result = await runBootstrapNotifyHook({}, deps);
    expect(result.outcome).toBe("backend_failed");
    expect(warns.length).toBeGreaterThan(0);
    expect(writes).toHaveLength(0);
  });
});
