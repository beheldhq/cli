/**
 * Module 2 — notify-commands. Tests for `beheld notify settings`.
 */
import { describe, expect, test } from "bun:test";

import { notifySettingsCommand } from "../../src/commands/notify/settings";
import type { IdentityClient, NotifyUpdatePayload } from "../../src/client/identity";

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
    },
  };
}

async function runQuiet(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    if (!(e instanceof Error) || !/^__exit_/.test(e.message)) throw e;
  }
}

function stubClient(): { client: IdentityClient; lastPatch: NotifyUpdatePayload | null } {
  const ref: { lastPatch: NotifyUpdatePayload | null } = { lastPatch: null };
  const client: IdentityClient = {
    postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
    deleteEmail: async () => undefined,
    patchNotify: async (p) => { ref.lastPatch = p; return {}; },
    getStatus: async () => { throw new Error("not used"); },
    getMachines: async () => [],
    deleteMachine: async () => undefined,
  };
  return { client, lastPatch: ref.lastPatch as never };
}

describe("notify settings", () => {
  test("default (no flags) implies --show without calling PATCH", async () => {
    const { client } = stubClient();
    const { captured, deps } = buildSink();
    let patched = false;
    const wrappedClient: IdentityClient = {
      ...client,
      patchNotify: async () => { patched = true; return {}; },
    };
    await runQuiet(() => notifySettingsCommand({}, {
      client: wrappedClient, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: (() => ({})) as never,
    }));
    expect(captured.code).toBe(0);
    expect(patched).toBe(false);
  });

  test("--off sends all four consents as false", async () => {
    const ref: { patch: NotifyUpdatePayload | null } = { patch: null };
    const client: IdentityClient = {
      postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
      deleteEmail: async () => undefined,
      patchNotify: async (p) => { ref.patch = p; return {}; },
      getStatus: async () => { throw new Error(); },
      getMachines: async () => [],
      deleteMachine: async () => undefined,
    };
    const { captured, deps } = buildSink();
    await runQuiet(() => notifySettingsCommand({ off: true }, {
      client, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: (() => ({})) as never,
    }));
    expect(captured.code).toBe(0);
    expect(ref.patch).toEqual({ security: false, recovery: false, bundle_events: false, weekly: false });
  });

  test("--weekly on seeds notify_weekly.next_signal_at locally", async () => {
    const ref: { patch: NotifyUpdatePayload | null } = { patch: null };
    const client: IdentityClient = {
      postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
      deleteEmail: async () => undefined,
      patchNotify: async (p) => { ref.patch = p; return {}; },
      getStatus: async () => { throw new Error(); },
      getMachines: async () => [],
      deleteMachine: async () => undefined,
    };
    const { deps } = buildSink();
    let lastWrite: Record<string, unknown> | null = null;
    await runQuiet(() => notifySettingsCommand({ weekly: "on" }, {
      client, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: ((patch: Record<string, unknown>) => { lastWrite = patch; return {}; }) as never,
      now: () => new Date("2026-06-12T00:00:00Z"),
    }));
    expect(ref.patch?.weekly).toBe(true);
    expect(lastWrite).not.toBeNull();
    const wk = (lastWrite as unknown as { notify_weekly?: { next_signal_at: string; enabled: boolean } })?.notify_weekly;
    expect(wk?.enabled).toBe(true);
    expect(wk?.next_signal_at).toBe("2026-06-19T00:00:00.000Z");
  });

  test("--threshold out of range exits with code 2", async () => {
    const { client } = stubClient();
    const { captured, deps } = buildSink();
    await runQuiet(() => notifySettingsCommand({ threshold: "99" }, {
      client, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: (() => ({})) as never,
    }));
    expect(captured.code).toBe(2);
  });

  test("--silent-weeks unknown value exits with code 2", async () => {
    const { client } = stubClient();
    const { captured, deps } = buildSink();
    await runQuiet(() => notifySettingsCommand({ silentWeeks: "bogus" }, {
      client, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: (() => ({})) as never,
    }));
    expect(captured.code).toBe(2);
  });

  test("partial flag (--security on) sends only the touched field", async () => {
    const ref: { patch: NotifyUpdatePayload | null } = { patch: null };
    const client: IdentityClient = {
      postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
      deleteEmail: async () => undefined,
      patchNotify: async (p) => { ref.patch = p; return {}; },
      getStatus: async () => { throw new Error(); },
      getMachines: async () => [],
      deleteMachine: async () => undefined,
    };
    const { captured, deps } = buildSink();
    await runQuiet(() => notifySettingsCommand({ security: "on" }, {
      client, ...deps,
      readNotifyState: () => ({}),
      writeNotifyState: (() => ({})) as never,
    }));
    expect(captured.code).toBe(0);
    expect(ref.patch).toEqual({ security: true });
  });
});
