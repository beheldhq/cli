/**
 * Module 3 — verifies that authenticatedFetch injects the Accept-Language
 * header by default and respects caller overrides.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authenticatedFetch } from "../../src/client/authenticated-fetch";
import {
  SESSION_SCHEMA_VERSION,
  writeSession,
  type PersistedSession,
} from "../../src/storage/session";

let workDir: string;
let beheldDir: string;

function freshSession(): PersistedSession {
  const now = Date.now();
  return {
    schema_version: SESSION_SCHEMA_VERSION,
    token: "tok-fresh",
    fingerprint: "f".repeat(64),
    api_base: "https://api.beheld.test",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-accept-lang-"));
  beheldDir = join(workDir, ".beheld");
  writeSession(freshSession(), beheldDir);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("Accept-Language injection", () => {
  test("default request includes Accept-Language from env", async () => {
    // detectLocale reads LC_ALL || LANG || LANGUAGE. CI runners usually set
    // LC_ALL (e.g. C.UTF-8), which would win over LANG — clear the
    // higher-precedence vars so LANG drives the result deterministically.
    const prev = {
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      LANGUAGE: process.env.LANGUAGE,
    };
    delete process.env.LC_ALL;
    delete process.env.LANGUAGE;
    process.env.LANG = "pt_BR.UTF-8";
    try {
      let seenHeader: string | null = null;
      const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        seenHeader = new Headers(init?.headers).get("Accept-Language");
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;

      await authenticatedFetch("https://api.beheld.test/x", {}, {
        fetch: fetchFn,
        baseDir: beheldDir,
      });

      expect(seenHeader).toBe("pt-BR,en;q=0.9,es;q=0.8");
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("caller-provided Accept-Language wins", async () => {
    let seenHeader: string | null = null;
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeader = new Headers(init?.headers).get("Accept-Language");
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await authenticatedFetch("https://api.beheld.test/x", {
      headers: { "Accept-Language": "fr-FR" },
    }, {
      fetch: fetchFn,
      baseDir: beheldDir,
    });

    expect(seenHeader).toBe("fr-FR");
  });
});
