/**
 * `beheld auth` — authenticate with the portal and open the dev dashboard.
 *
 * Flow:
 *   1. Load the dev's Ed25519 keypair from ~/.beheld/keys/
 *   2. Derive the fingerprint (hex public key)
 *   3. POST /api/v1/auth/challenge { fingerprint } → { nonce }
 *   4. Sign the nonce bytes with the private key
 *   5. POST /api/v1/auth/verify { fingerprint, nonce, signature } → { session_token, redirect_url }
 *   6. Persist the session_token to ~/.beheld/session.json (module 2A —
 *      bearer-token-persistence). Subsequent CLI commands use it via
 *      `authenticatedFetch` instead of re-running the dance.
 *   7. Open the dashboard URL in the browser
 */
import { getPortalUrl } from "../config/env";
import { loadPublicJwk, loadPrivateKey, keysExist, publicKeyFingerprint } from "../keys/keystore";
import { writeSession, SESSION_SCHEMA_VERSION } from "../storage/session";

const bold  = (s: string) => `\x1b[1m${s}\x1b[22m`;
const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";
const ok    = (s: string) => `\x1b[32m✓\x1b[39m ${s}`;
const fail  = (s: string) => `\x1b[31m✗\x1b[39m ${s}`;

function portalUrl(): string {
  return getPortalUrl();
}

function fingerprint(jwk: { x: string }): string {
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export async function authCommand(): Promise<void> {
  console.log(`${DIM}beheld auth${RESET}`);

  if (!keysExist()) {
    console.log(fail("keys not found. run `beheld init` first."));
    process.exit(1);
  }

  const pubJwk = loadPublicJwk();
  const fp = fingerprint(pubJwk);
  const privKey = await loadPrivateKey();
  const base = portalUrl();

  console.log(`  ${DIM}fingerprint:${RESET} ${fp.slice(0, 16)}…`);
  console.log(`  ${DIM}portal:${RESET}      ${base}`);

  // 1. Challenge
  let nonce: string;
  try {
    const r = await fetch(`${base}/api/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fp }),
    });
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 404) {
        console.log(fail("account not found. publish your profile first with `beheld share`."));
      } else {
        console.log(fail(`challenge failed: HTTP ${r.status} — ${body.slice(0, 200)}`));
      }
      process.exit(1);
    }
    const data = await r.json() as { nonce: string };
    nonce = data.nonce;
  } catch (e) {
    console.log(fail(`could not connect to portal: ${(e as Error).message}`));
    process.exit(1);
  }

  // 2. Sign the nonce bytes
  const nonceBytes = Uint8Array.from(Buffer.from(nonce, "hex"));
  const sigBytes = new Uint8Array(await crypto.subtle.sign("Ed25519", privKey, nonceBytes));
  const sigHex = Buffer.from(sigBytes).toString("hex");

  // 3. Verify
  let redirectUrl: string;
  try {
    const r = await fetch(`${base}/api/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fp, nonce, signature: sigHex }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.log(fail(`verification failed: HTTP ${r.status} — ${body.slice(0, 200)}`));
      process.exit(1);
    }
    const data = await r.json() as {
      session_token: string;
      redirect_url: string;
      expires_at?: string;
    };
    redirectUrl = `${base}${data.redirect_url}`;

    // Persist the bearer token so future CLI commands can authenticate via
    // `authenticatedFetch` without re-running the challenge/verify dance.
    // Module 2A — bearer-token-persistence. Fingerprint is the hex pubkey;
    // base is the portal/api root the token is valid against.
    const createdAt = new Date();
    const expiresAt = data.expires_at
      ? new Date(data.expires_at)
      : new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    writeSession({
      schema_version: SESSION_SCHEMA_VERSION,
      token: data.session_token,
      fingerprint: fp,
      api_base: base,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  } catch (e) {
    console.log(fail(`verification error: ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(ok("authenticated"));
  console.log(`  ${bold(redirectUrl)}`);

  // 4. Open browser
  const { exec } = await import("node:child_process");
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} "${redirectUrl}"`);
}
