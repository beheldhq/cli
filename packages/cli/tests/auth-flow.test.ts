import { describe, expect, test } from "bun:test";

import { runAuthFlow, AuthFlowError, type AuthFlowDeps } from "../src/client/auth-flow";
import { SESSION_SCHEMA_VERSION } from "../src/storage/session";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A real Ed25519 keypair so the sign step exercises actual WebCrypto. The
 *  public JWK's `x` is what the flow turns into the hex fingerprint. */
async function realKeyDeps(): Promise<{
  privKey: CryptoKey;
  pubJwk: JsonWebKey;
  fingerprint: string;
}> {
  const kp = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as Algorithm,
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pubJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const fingerprint = Buffer.from(pubJwk.x as string, "base64url").toString("hex");
  return { privKey: kp.privateKey, pubJwk, fingerprint };
}

const NONCE = "ab".repeat(16); // 32-byte hex nonce
const API = "https://api.test";

interface RouteResponses {
  challenge?: () => Response;
  verify?: () => Response;
}

/** Build a fetch mock that records calls and routes by URL suffix. */
function fetchMock(routes: RouteResponses): {
  fetch: typeof fetch;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith("/auth/challenge")) {
      return (routes.challenge ?? (() => new Response(JSON.stringify({ nonce: NONCE }), { status: 200 })))();
    }
    if (u.endsWith("/auth/verify")) {
      return (routes.verify ??
        (() => new Response(JSON.stringify({ session_token: "tok", expires_at: "2026-07-01T00:00:00Z" }), { status: 200 })))();
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

async function depsWith(routes: RouteResponses, over: Partial<AuthFlowDeps> = {}): Promise<{
  deps: AuthFlowDeps;
  calls: { url: string; body: unknown }[];
  fingerprint: string;
}> {
  const { privKey, pubJwk, fingerprint } = await realKeyDeps();
  const { fetch: f, calls } = fetchMock(routes);
  const deps: AuthFlowDeps = {
    fetch: f,
    loadPublicJwk: () => pubJwk as never,
    loadPrivateKey: async () => privKey,
    apiBase: API,
    ...over,
  };
  return { deps, calls, fingerprint };
}

// ── happy path ───────────────────────────────────────────────────────────────

describe("runAuthFlow — success", () => {
  test("completes challenge → sign → verify and returns a persisted session", async () => {
    const { deps, calls, fingerprint } = await depsWith({}, { now: () => new Date("2026-06-22T12:00:00Z") });
    const session = await runAuthFlow(deps);

    expect(session.schema_version).toBe(SESSION_SCHEMA_VERSION);
    expect(session.token).toBe("tok");
    expect(session.fingerprint).toBe(fingerprint);
    expect(session.api_base).toBe(API);
    expect(session.created_at).toBe("2026-06-22T12:00:00.000Z");
    expect(session.expires_at).toBe("2026-07-01T00:00:00.000Z");

    // challenge sends the fingerprint; verify sends a real signature over the nonce
    expect(calls[0]!.url).toBe(`${API}/api/v1/auth/challenge`);
    expect((calls[0]!.body as { fingerprint: string }).fingerprint).toBe(fingerprint);
    const verifyBody = calls[1]!.body as { fingerprint: string; nonce: string; signature: string };
    expect(verifyBody.nonce).toBe(NONCE);
    expect(verifyBody.signature).toMatch(/^[0-9a-f]{128}$/); // Ed25519 sig = 64 bytes hex
  });

  test("defaults expires_at to created_at + 24h when the server omits it", async () => {
    const { deps } = await depsWith(
      { verify: () => new Response(JSON.stringify({ session_token: "tok" }), { status: 200 }) },
      { now: () => new Date("2026-06-22T12:00:00Z") },
    );
    const session = await runAuthFlow(deps);
    expect(session.expires_at).toBe("2026-06-23T12:00:00.000Z");
  });
});

// ── error stages ─────────────────────────────────────────────────────────────

describe("runAuthFlow — error classification", () => {
  test("keystore stage when the public key fails to load", async () => {
    const { deps } = await depsWith({}, {
      loadPublicJwk: () => { throw new Error("no pub"); },
    });
    await expect(runAuthFlow(deps)).rejects.toMatchObject({
      name: "AuthFlowError",
      stage: "keystore",
    });
  });

  test("keystore stage when the private key fails to load", async () => {
    const { deps } = await depsWith({}, {
      loadPrivateKey: async () => { throw new Error("no priv"); },
    });
    await expect(runAuthFlow(deps)).rejects.toMatchObject({ stage: "keystore" });
  });

  test("challenge stage (with status) on a non-ok challenge response", async () => {
    const { deps } = await depsWith({ challenge: () => new Response("nope", { status: 503 }) });
    const err = await runAuthFlow(deps).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFlowError);
    expect(err.stage).toBe("challenge");
    expect(err.status).toBe(503);
  });

  test("network stage when the challenge request throws", async () => {
    const { deps } = await depsWith({ challenge: () => { throw new Error("ECONNREFUSED"); } });
    await expect(runAuthFlow(deps)).rejects.toMatchObject({ stage: "network" });
  });

  test("verify stage (with status) on a non-ok verify response", async () => {
    const { deps } = await depsWith({ verify: () => new Response("denied", { status: 401 }) });
    const err = await runAuthFlow(deps).catch((e) => e);
    expect(err.stage).toBe("verify");
    expect(err.status).toBe(401);
  });

  test("network stage when the verify request throws", async () => {
    const { deps } = await depsWith({ verify: () => { throw new Error("ENOTFOUND"); } });
    await expect(runAuthFlow(deps)).rejects.toMatchObject({ stage: "network" });
  });

  test("sign stage when the private key cannot sign", async () => {
    // A non-CryptoKey privKey makes crypto.subtle.sign throw after a successful
    // challenge, isolating the sign branch.
    const { deps } = await depsWith({}, {
      loadPrivateKey: async () => ({}) as unknown as CryptoKey,
    });
    await expect(runAuthFlow(deps)).rejects.toMatchObject({ stage: "sign" });
  });
});
