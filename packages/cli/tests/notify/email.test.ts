/**
 * Module 2 — notify-commands. Tests for `beheld notify email`.
 */
import { describe, expect, test } from "bun:test";

import { notifyEmailCommand } from "../../src/commands/notify/email";
import {
  IdentityCapReached,
  IdentityRateLimited,
  type CreateEmailResponse,
  type EmailPurpose,
  type IdentityClient,
} from "../../src/client/identity";

interface ClientCall { method: string; args: unknown }

function buildClient(handlers: Partial<IdentityClient>): { client: IdentityClient; calls: ClientCall[] } {
  const calls: ClientCall[] = [];
  const wrap = <K extends keyof IdentityClient>(method: K): IdentityClient[K] => {
    const fn = handlers[method] as IdentityClient[K] | undefined;
    return (async (args: unknown) => {
      calls.push({ method, args });
      if (!fn) throw new Error(`${method} not stubbed`);
      return (fn as (a: unknown) => unknown)(args);
    }) as IdentityClient[K];
  };
  const client: IdentityClient = {
    postEmail: wrap("postEmail"),
    deleteEmail: wrap("deleteEmail"),
    patchNotify: wrap("patchNotify"),
    getStatus: wrap("getStatus"),
    getMachines: wrap("getMachines"),
    deleteMachine: wrap("deleteMachine"),
  };
  return { client, calls };
}

interface CapturedExit { code: number | null; logs: string[]; errs: string[] }

function buildSink() {
  const captured: CapturedExit = { code: null, logs: [], errs: [] };
  return {
    captured,
    deps: {
      log: (m: string) => captured.logs.push(m),
      errLog: (m: string) => captured.errs.push(m),
      exit: ((c: number) => {
        captured.code = c;
        throw new Error(`__exit_${c}__`);
      }) as (code: number) => never,
      writeNotifyState: (() => ({})) as never,
      clearNotifyState: (() => ({})) as never,
    },
  };
}

async function runQuiet(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    if (!(e instanceof Error) || !/^__exit_/.test(e.message)) throw e;
  }
}

describe("notify email — create", () => {
  test("defaults purpose=notification and writes state on 201", async () => {
    const { client, calls } = buildClient({
      postEmail: async (): Promise<CreateEmailResponse> => ({
        purpose: "notification",
        email: "a@b.test",
        verified: false,
        token_expires_at: "2026-06-13T10:00Z",
      }),
    });
    const { captured, deps } = buildSink();
    let wroteWith: unknown = null;
    deps.writeNotifyState = ((patch: unknown) => { wroteWith = patch; return {}; }) as never;

    await runQuiet(() => notifyEmailCommand("a@b.test", {}, { client, ...deps }));

    expect(captured.code).toBe(0);
    expect(calls[0].method).toBe("postEmail");
    expect((calls[0].args as { purpose: EmailPurpose }).purpose).toBe("notification");
    expect(wroteWith).toEqual({
      notification_email: { value: "a@b.test", verified: false, verified_at: null },
    });
  });

  test("--purpose=recovery hits recovery_email", async () => {
    const { client } = buildClient({
      postEmail: async (): Promise<CreateEmailResponse> => ({
        purpose: "recovery",
        email: "r@b.test",
        verified: false,
        token_expires_at: "2026-06-13T10:00Z",
      }),
    });
    const { deps } = buildSink();
    let wroteWith: unknown = null;
    deps.writeNotifyState = ((patch: unknown) => { wroteWith = patch; return {}; }) as never;

    await runQuiet(() => notifyEmailCommand("r@b.test", { purpose: "recovery" }, { client, ...deps }));

    expect((wroteWith as Record<string, unknown>).recovery_email).toBeDefined();
  });

  test("invalid purpose exits with code 2", async () => {
    const { captured } = buildSink();
    const { client } = buildClient({});
    const { deps } = buildSink();
    await runQuiet(() =>
      notifyEmailCommand("a@b.test", { purpose: "marketing" }, { client, ...deps, exit: ((c: number) => {
        captured.code = c;
        throw new Error(`__exit_${c}__`);
      }) as (code: number) => never }),
    );
    expect(captured.code).toBe(2);
  });

  test("invalid email format exits with code 2", async () => {
    const { captured, deps } = buildSink();
    const { client } = buildClient({});
    await runQuiet(() => notifyEmailCommand("not-an-email", {}, { client, ...deps }));
    expect(captured.code).toBe(2);
  });

  test("missing address exits with code 2", async () => {
    const { captured, deps } = buildSink();
    const { client } = buildClient({});
    await runQuiet(() => notifyEmailCommand(undefined, {}, { client, ...deps }));
    expect(captured.code).toBe(2);
  });

  test("IdentityCapReached exits with code 3 and prints machines", async () => {
    const { client } = buildClient({
      postEmail: async () => {
        throw new IdentityCapReached({
          cap: 3,
          accounts: [
            { fingerprint_truncated: "aaaa1111", linked_at: "2026-06-10T10:00:00Z" },
            { fingerprint_truncated: "bbbb2222", linked_at: "2026-06-11T10:00:00Z" },
            { fingerprint_truncated: "cccc3333", linked_at: "2026-06-12T10:00:00Z" },
          ],
        });
      },
    });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyEmailCommand("a@b.test", {}, { client, ...deps }));
    expect(captured.code).toBe(3);
    expect(captured.errs.join("\n")).toContain("aaaa1111");
    expect(captured.errs.join("\n")).toContain("Limite");
  });

  test("rate limit exits with code 4 (backend bucket)", async () => {
    const { client } = buildClient({
      postEmail: async () => { throw new IdentityRateLimited(); },
    });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyEmailCommand("a@b.test", {}, { client, ...deps }));
    expect(captured.code).toBe(4);
  });
});

describe("notify email --remove", () => {
  test("prompts for confirmation and aborts on no", async () => {
    const { client, calls } = buildClient({
      deleteEmail: async () => undefined,
    });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyEmailCommand(undefined, { remove: true, purpose: "notification" }, {
      client, ...deps, confirm: async () => false,
    }));
    expect(captured.code).toBe(0);
    expect(calls.find((c) => c.method === "deleteEmail")).toBeUndefined();
  });

  test("--yes skips prompt and clears local state", async () => {
    const { client, calls } = buildClient({ deleteEmail: async () => undefined });
    const { captured, deps } = buildSink();
    let clearedScope: unknown = null;
    deps.clearNotifyState = ((scope: unknown) => { clearedScope = scope; return {}; }) as never;

    await runQuiet(() => notifyEmailCommand(undefined, { remove: true, purpose: "notification", yes: true }, {
      client, ...deps,
    }));
    expect(captured.code).toBe(0);
    expect(calls.find((c) => c.method === "deleteEmail")).toBeDefined();
    expect(clearedScope).toBe("notification");
  });
});
