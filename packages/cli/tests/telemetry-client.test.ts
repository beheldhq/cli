import { describe, expect, test } from "bun:test";

import { buildPayload, capture } from "../src/lib/telemetry-client";
import { VERSION } from "../src/version";

describe("buildPayload", () => {
  test("contains only version, os, arch, $lib in properties", () => {
    const p = buildPayload("hash-123", "cli_active_day", "phc_test");
    expect(Object.keys(p.properties).sort()).toEqual(["$lib", "arch", "os", "version"]);
    expect(p.properties.version).toBe(VERSION);
    expect(p.properties.$lib).toBe("beheld-cli");
    expect(p.event).toBe("cli_active_day");
    expect(p.distinct_id).toBe("hash-123");
    expect(p.api_key).toBe("phc_test");
  });

  test("timestamp is ISO-8601", () => {
    const p = buildPayload("x", "cli_installed", "phc_test");
    expect(p.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("capture", () => {
  test("posts JSON with the right shape", async () => {
    let calledUrl: string | URL | Request | undefined;
    let calledBody: string | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = url;
      calledBody = init?.body as string;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await capture({
      distinctId: "abc",
      event: "cli_active_day",
      apiKey: "phc_test",
      fetchImpl,
    });

    expect(String(calledUrl)).toBe("https://eu.posthog.com/capture/");
    const parsed = JSON.parse(calledBody!);
    expect(parsed.event).toBe("cli_active_day");
    expect(parsed.distinct_id).toBe("abc");
    expect(parsed.api_key).toBe("phc_test");
    expect(parsed.properties.$lib).toBe("beheld-cli");
  });

  test("swallows fetch errors silently", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
    await expect(
      capture({ distinctId: "abc", event: "cli_active_day", apiKey: "phc_test", fetchImpl }),
    ).resolves.toBeUndefined();
  });

  test("aborts after 2 seconds (timeout signal wired)", async () => {
    let signalReceived: AbortSignal | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      signalReceived = init?.signal as AbortSignal;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await capture({ distinctId: "x", event: "cli_installed", apiKey: "phc_test", fetchImpl });
    expect(signalReceived).toBeDefined();
  });
});
