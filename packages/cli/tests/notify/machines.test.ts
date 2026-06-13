/**
 * Module 2 — notify-commands. Tests for `beheld notify machines`.
 */
import { describe, expect, test } from "bun:test";

import { notifyMachinesCommand } from "../../src/commands/notify/machines";
import { IdentityValidationError, type BackendMachine, type IdentityClient } from "../../src/client/identity";

function sampleMachines(): BackendMachine[] {
  return [
    { account_id: 1, fingerprint_truncated: "aaaa1111", linked_at: "2026-06-05T14:30:00Z", last_seen_at: null, is_current: true },
    { account_id: 2, fingerprint_truncated: "bbbb2222", linked_at: "2026-06-06T14:30:00Z", last_seen_at: null, is_current: false },
  ];
}

interface CapturedExit { code: number | null; logs: string[]; errs: string[] }
function buildSink() {
  const captured: CapturedExit = { code: null, logs: [], errs: [] };
  return {
    captured,
    deps: {
      log: (m: string) => captured.logs.push(m),
      errLog: (m: string) => captured.errs.push(m),
      exit: ((c: number) => { captured.code = c; throw new Error(`__exit_${c}__`); }) as (code: number) => never,
    },
  };
}

async function runQuiet(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    if (!(e instanceof Error) || !/^__exit_/.test(e.message)) throw e;
  }
}

function buildClient(opts: { delete?: () => Promise<void> } = {}): IdentityClient {
  return {
    postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
    deleteEmail: async () => undefined,
    patchNotify: async () => ({}),
    getStatus: async () => { throw new Error(); },
    getMachines: async () => sampleMachines(),
    deleteMachine: opts.delete ?? (async () => undefined),
  };
}

describe("notify machines — list", () => {
  test("renders list with current marker", async () => {
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({}, { client: buildClient(), ...deps }));
    expect(captured.code).toBe(0);
    expect(captured.logs.join("\n")).toContain("aaaa1111");
    expect(captured.logs.join("\n")).toContain("este dispositivo");
  });

  test("--json renders JSON", async () => {
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ json: true }, { client: buildClient(), ...deps }));
    const parsed = JSON.parse(captured.logs[0]) as BackendMachine[];
    expect(parsed).toHaveLength(2);
  });
});

describe("notify machines --unlink", () => {
  test("unknown fingerprint exits 2", async () => {
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ unlink: "zzzz0000" }, { client: buildClient(), ...deps }));
    expect(captured.code).toBe(2);
  });

  test("self-unlink refused with sugestão clara", async () => {
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ unlink: "aaaa1111", yes: true }, { client: buildClient(), ...deps }));
    expect(captured.code).toBe(2);
    expect(captured.errs.join("\n")).toContain("--purpose=notification");
  });

  test("sibling unlink with --yes calls deleteMachine", async () => {
    let deleted: number | null = null;
    const client = buildClient({
      delete: async () => { deleted = 2; },
    });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ unlink: "bbbb2222", yes: true }, { client, ...deps }));
    expect(captured.code).toBe(0);
    expect(deleted).toBe(2);
  });

  test("confirm=no aborts without calling deleteMachine", async () => {
    let called = false;
    const client = buildClient({ delete: async () => { called = true; } });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ unlink: "bbbb2222" }, {
      client, ...deps, confirm: async () => false,
    }));
    expect(captured.code).toBe(0);
    expect(called).toBe(false);
  });

  test("backend self-guard (422) surfaces as ARG exit (2)", async () => {
    const client = buildClient({
      delete: async () => { throw new IdentityValidationError(["cannot_unlink_self_via_machines_endpoint"]); },
    });
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyMachinesCommand({ unlink: "bbbb2222", yes: true }, { client, ...deps }));
    expect(captured.code).toBe(2);
  });
});
