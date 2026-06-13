/**
 * Module 3 — bootstrap-and-share-prompts. Tests for the post-share
 * secondary opt-in offer.
 */
import { describe, expect, test } from "bun:test";

import {
  isSecondaryOfferEligible,
  runShareSecondaryHook,
  type ShareSecondaryHookDeps,
} from "../../src/commands/notify/share-hook";
import type {
  IdentityClient,
  NotifyUpdatePayload,
} from "../../src/client/identity";
import type { NotifyState } from "../../src/storage/notify";

function stubClient(opts: { patchNotify?: (p: NotifyUpdatePayload) => Promise<unknown> } = {}): IdentityClient {
  return {
    postEmail: async () => ({ purpose: "notification", email: "", verified: false, token_expires_at: "" }),
    deleteEmail: async () => undefined,
    patchNotify: opts.patchNotify ?? (async () => ({})),
    getStatus: async () => { throw new Error("not used"); },
    getMachines: async () => [],
    deleteMachine: async () => undefined,
  };
}

function stubPrompter(answers: string[]) {
  const queue = [...answers];
  let closed = false;
  return {
    prompter: {
      ask: async () => queue.shift() ?? "",
      close: () => { closed = true; },
    },
    isClosed: () => closed,
  };
}

const VERIFIED_STATE: NotifyState = {
  notification_email: {
    value: "dev@example.test",
    verified: true,
    verified_at: "2026-06-12T10:00:00Z",
  },
  notify_consents: { security: true, recovery: true, bundle_events: false, weekly: false },
  notify_secondary_offer_shown: false,
};

function buildDeps(overrides: Partial<ShareSecondaryHookDeps> = {}): {
  deps: ShareSecondaryHookDeps;
  logs: string[];
  writes: NotifyState[];
} {
  const logs: string[] = [];
  const writes: NotifyState[] = [];
  return {
    deps: {
      log: (l) => logs.push(l),
      warn: (l) => logs.push(`[warn] ${l}`),
      readNotifyState: () => VERIFIED_STATE,
      writeNotifyState: ((patch) => { writes.push(patch as NotifyState); return {}; }) as never,
      identityClient: stubClient(),
      isInteractive: () => true,
      now: () => new Date("2026-06-12T00:00:00Z"),
      ...overrides,
    },
    logs, writes,
  };
}

describe("isSecondaryOfferEligible", () => {
  test("eligible: verified email, not shown yet", () => {
    expect(isSecondaryOfferEligible(VERIFIED_STATE)).toBe(true);
  });
  test("not eligible: already shown", () => {
    expect(isSecondaryOfferEligible({ ...VERIFIED_STATE, notify_secondary_offer_shown: true })).toBe(false);
  });
  test("not eligible: email unverified", () => {
    expect(isSecondaryOfferEligible({
      ...VERIFIED_STATE,
      notification_email: { value: "x@y.test", verified: false, verified_at: null },
    })).toBe(false);
  });
  test("not eligible: no email", () => {
    expect(isSecondaryOfferEligible({})).toBe(false);
  });
});

describe("runShareSecondaryHook", () => {
  test("not_eligible when email unverified — no prompt, no write", async () => {
    const { deps, writes } = buildDeps({
      readNotifyState: () => ({
        ...VERIFIED_STATE,
        notification_email: { value: "x@y.test", verified: false, verified_at: null },
      }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result.outcome).toBe("not_eligible");
    expect(writes).toHaveLength(0);
  });

  test("not_eligible when secondary_offer_shown=true", async () => {
    const { deps } = buildDeps({
      readNotifyState: () => ({ ...VERIFIED_STATE, notify_secondary_offer_shown: true }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result.outcome).toBe("not_eligible");
  });

  test("non-interactive: skipped without marking shown=true", async () => {
    const { deps, writes } = buildDeps({ isInteractive: () => false });
    const result = await runShareSecondaryHook(deps);
    expect(result.outcome).toBe("skipped_non_interactive");
    expect(writes).toHaveLength(0);
  });

  test("both N: marks shown=true, no patchNotify", async () => {
    const promptStub = stubPrompter(["N", "N"]);
    let patched = false;
    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({ patchNotify: async () => { patched = true; return {}; } }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result.outcome).toBe("shown_no_opt_in");
    expect(patched).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0].notify_secondary_offer_shown).toBe(true);
  });

  test("both Y: patchNotify with both flags, weekly seeds next_signal_at", async () => {
    const promptStub = stubPrompter(["Y", "Y"]);
    let patchedWith: NotifyUpdatePayload | null = null;
    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({
        patchNotify: async (p) => { patchedWith = p; return {}; },
      }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result).toEqual({ outcome: "shown_opt_in", enabled: { bundle_events: true, weekly: true } });
    expect(patchedWith).toEqual({ bundle_events: true, weekly: true });

    expect(writes).toHaveLength(1);
    const wrote = writes[0];
    expect(wrote.notify_secondary_offer_shown).toBe(true);
    expect(wrote.notify_consents).toEqual({
      security: true,
      recovery: true,
      bundle_events: true,
      weekly: true,
    });
    expect(wrote.notify_weekly?.enabled).toBe(true);
    expect(wrote.notify_weekly?.next_signal_at).toBe("2026-06-19T00:00:00.000Z");
  });

  test("only bundle_events Y: weekly stays disabled, no next_signal_at", async () => {
    const promptStub = stubPrompter(["Y", "N"]);
    let patchedWith: NotifyUpdatePayload | null = null;
    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({
        patchNotify: async (p) => { patchedWith = p; return {}; },
      }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result.enabled).toEqual({ bundle_events: true, weekly: false });
    expect(patchedWith).toEqual({ bundle_events: true, weekly: false });
    expect(writes[0].notify_weekly?.enabled).toBe(false);
    expect(writes[0].notify_weekly?.next_signal_at).toBe(null);
  });

  test("patchNotify failure: still marks shown=true (avoid re-asking)", async () => {
    const promptStub = stubPrompter(["Y", "Y"]);
    const { deps, writes } = buildDeps({
      prompter: promptStub.prompter,
      identityClient: stubClient({ patchNotify: async () => { throw new Error("server down"); } }),
    });
    const result = await runShareSecondaryHook(deps);
    expect(result.outcome).toBe("shown_no_opt_in");
    expect(writes).toHaveLength(1);
    expect(writes[0].notify_secondary_offer_shown).toBe(true);
  });
});
