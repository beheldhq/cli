/**
 * Module 2 — notify-commands. Tests for `beheld notify status`.
 */
import { describe, expect, test } from "bun:test";

import { notifyStatusCommand, renderText } from "../../src/commands/notify/status";
import type { IdentityClient, IdentityStatus } from "../../src/client/identity";

function sampleStatus(): IdentityStatus {
  return {
    notification_email: {
      email: "dev@example.test",
      verified: true,
      verified_at: "2026-06-05T14:32:00Z",
      link_confirmed: true,
      linked_at: "2026-06-05T14:30:00Z",
    },
    recovery_email: null,
    consents: { security: true, recovery: true, bundle_events: false, weekly: true },
    delta_threshold: 5,
    silent_weeks_policy: "notify",
    weekly: {
      last_digest_sent_at: null,
      next_digest_expected_at: "2026-06-19T00:00:00Z",
    },
    machines: [
      { account_id: 1, fingerprint_truncated: "a4c1fffe", linked_at: "2026-06-05T14:30:00Z", last_seen_at: "2026-06-12T10:00:00Z", is_current: true },
    ],
  };
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
      writeNotifyState: (() => ({})) as never,
    },
  };
}

async function runQuiet(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    if (!(e instanceof Error) || !/^__exit_/.test(e.message)) throw e;
  }
}

function buildClient(status: IdentityStatus): IdentityClient {
  return {
    postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
    deleteEmail: async () => undefined,
    patchNotify: async () => ({}),
    getStatus: async () => status,
    getMachines: async () => status.machines,
    deleteMachine: async () => undefined,
  };
}

describe("notify status — text rendering", () => {
  test("includes email, consents marker, and machines", () => {
    const text = renderText(sampleStatus());
    expect(text).toContain("dev@example.test");
    expect(text).toContain("[x] segurança");
    expect(text).toContain("[ ] bundle events");
    expect(text).toContain("[x] weekly digest");
    expect(text).toContain("este dispositivo");
    expect(text).toContain("a4c1fffe");
    // No emojis (witness voice).
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}]/u);
  });

  test("renders '(não configurado)' when no notification email", () => {
    const status = sampleStatus();
    status.notification_email = null;
    const text = renderText(status);
    expect(text).toContain("(não configurado)");
  });
});

describe("notify status — command", () => {
  test("--json prints parseable JSON", async () => {
    const client = buildClient(sampleStatus());
    const { captured, deps } = buildSink();
    await runQuiet(() => notifyStatusCommand({ json: true }, { client, ...deps }));
    expect(captured.code).toBe(0);
    const parsed = JSON.parse(captured.logs[0]) as IdentityStatus;
    expect(parsed.notification_email?.email).toBe("dev@example.test");
  });

  test("reconciles local state with backend response", async () => {
    const client = buildClient(sampleStatus());
    const { captured, deps } = buildSink();
    let wroteWith: Record<string, unknown> | null = null;
    deps.writeNotifyState = ((p: Record<string, unknown>) => { wroteWith = p; return {}; }) as never;
    await runQuiet(() => notifyStatusCommand({}, { client, ...deps }));
    expect(captured.code).toBe(0);
    expect(wroteWith).not.toBeNull();
    const w = wroteWith as unknown as { notification_email?: { value: string }; notify_consents?: { weekly: boolean } };
    expect(w?.notification_email?.value).toBe("dev@example.test");
    expect(w?.notify_consents?.weekly).toBe(true);
  });
});
