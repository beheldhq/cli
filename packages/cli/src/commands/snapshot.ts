import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BUNDLE_VERSION, type Bundle, type BundlePayload, type RekorEntry } from "../bundle/types";
import { payloadHash, payloadToCanonical } from "../bundle/canonical";
import { composition } from "../bundle/verify";
import { getRekorUrl } from "../config/env";
// renderQr is consumed lazily from ./share.ts when a publish succeeds —
// no top-level import here keeps snapshot.ts free of the publish path.
import {
  ensureKeys,
  loadPrivateKey,
  loadPublicJwk,
  publicKeyFingerprint,
} from "../keys/keystore";
import { loadAttestationCache } from "../keys/attestation-cache";
import {
  submitToRekor,
  type RekorFailureReason,
  type RekorSubmitResult,
} from "../lib/rekor";
import { computeTier } from "../lib/tier";
import { ok, fail, warn, arrow, meta, bold, brand, DIM, RESET, YELLOW, GREEN } from "../ui/styles";
import { renderSnapshotHtml, type SnapshotHtmlData } from "../ui/snapshot-html";

const ENGINE_URL = process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";

interface SnapshotOptions {
  output?: string;
  share?: boolean;
  html?: boolean;
  authorName?: string;
  /** F5.8 — promote an existing bundle to fully_verifiable by submitting
   *  its hash + signature to Rekor and rewriting the file in place. */
  rekorSubmit?: string;
  /** F5.8 — skip Rekor submission for this snapshot (offline mode). */
  noRekor?: boolean;
}

interface SnapshotRow {
  id: number;
  hash: string;
  previous_hash: string | null;
  created_at: string;
  bundle_path: string | null;
}

function dataDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** "sha256:abcd…" → "abcd…" / "ed25519:abcd…" → "abcd…". */
function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** JWK `x` (base64url, unpadded) → 32-byte raw key in hex. */
function jwkXToHex(jwkX: string): string {
  return Buffer.from(jwkX, "base64url").toString("hex");
}

/** Human-facing label for a Rekor failure reason — replaces the previous
 *  catch-all "network unavailable" with an honest message per cause. */
function rekorFailureLabel(reason: RekorFailureReason, detail: string): string {
  switch (reason) {
    case "timeout":
      return `timed out (${detail})`;
    case "network":
      return `network unavailable (${detail})`;
    case "rejected":
      return `Rekor refused: ${detail}`;
    case "encoding":
      return `local encoding error: ${detail}`;
    case "malformed":
      return `invalid Rekor response: ${detail}`;
    default:
      return `unknown failure (${detail})`;
  }
}

function renderRekorLine(result: RekorSubmitResult | null): string {
  if (result == null) {
    // --no-rekor: opt-out. Different message from a failure.
    return `${YELLOW}⚠${RESET} skipped by --no-rekor`;
  }
  if (result.ok) {
    return `${GREEN}✓${RESET} log #${result.entry.logIndex} · ${result.entry.integratedTime}`;
  }
  return `${YELLOW}⚠${RESET} not recorded ${meta(
    `(${rekorFailureLabel(result.reason, result.detail)} — resubmit: beheld snapshot --rekor-submit <bundle>)`,
  )}`;
}

function bundleFilename(createdAt: string, hash: string): string {
  // 2026-05-14T03:42:00+00:00 → 20260514
  const dateStr = createdAt.slice(0, 10).replace(/-/g, "");
  // sha256:abc... → abc
  const hashShort = hash.slice("sha256:".length, "sha256:".length + 8);
  return `${dateStr}_${hashShort}.beheld`;
}

/** Resolve the convenience-copy directory. Returns null when no usable
 *  destination exists — caller should silently skip in that case.
 *
 *  Precedence:
 *    1. BEHELD_DESKTOP_DIR env (explicit override, e.g. for tests or CI)
 *    2. ~/Desktop if it exists (works on macOS, Windows, and most Linux setups)
 *    3. null
 *
 *  Set BEHELD_NO_DESKTOP_COPY=1 to opt out entirely.
 */
function desktopCopyDir(): string | null {
  if (process.env.BEHELD_NO_DESKTOP_COPY === "1") return null;
  const override = process.env.BEHELD_DESKTOP_DIR;
  if (override) return existsSync(override) ? override : null;
  const candidate = join(homedir(), "Desktop");
  return existsSync(candidate) ? candidate : null;
}

export async function snapshotCommand(opts: SnapshotOptions = {}): Promise<void> {
  if (opts.rekorSubmit) {
    await rekorSubmitExisting(opts.rekorSubmit);
    return;
  }
  console.log(brand("capturing the moment"));
  await ensureKeys();

  // 1. Engine builds the payload (no signing yet)
  let payload: BundlePayload;
  try {
    const r = await fetch(`${ENGINE_URL}/snapshot/payload`, { method: "POST" });
    if (r.status === 409) {
      const body = await r.json().catch(() => ({ detail: "" }));
      console.error("✗ Not enough data yet to generate a snapshot.");
      console.error(`  ${body.detail || "Use Claude Code for a few sessions and try again."}`);
      process.exit(1);
    }
    if (!r.ok) {
      console.error(fail(`engine returned ${r.status}`));
      console.error(`     ${DIM}Run: beheld start${RESET}`);
      process.exit(1);
    }
    payload = (await r.json()) as BundlePayload;
  } catch (err) {
    console.error(fail("engine offline or unreachable"));
    console.error(`     ${DIM}Run: beheld start${RESET}`);
    process.exit(1);
  }

  // 2. Canonicalize, hash, sign
  const canonical = payloadToCanonical(payload);
  const hash = await payloadHash(payload);
  const privKey = await loadPrivateKey();
  const sigBuf = await crypto.subtle.sign(
    { name: "Ed25519" },
    privKey,
    new TextEncoder().encode(canonical),
  );
  const pubJwk = loadPublicJwk();

  // Embed the identity attestation if the dev has run `beheld attest`.
  // The attestation lives at the wrapper level so adding it doesn't change
  // the bundle hash (Phase 5 / F5.6.1.e).
  const attestation = loadAttestationCache();

  const signatureHex = toHex(sigBuf);
  const publicKeyHex = jwkXToHex(pubJwk.x);

  // F5.8 — best-effort Rekor submission BEFORE we write the bundle so the
  // inclusion proof can be embedded in the wrapper. Submission is synchronous
  // with an 8s timeout — if Rekor doesn't respond in time, the bundle is
  // still saved without rekor and the user can promote it later with
  // `beheld snapshot --rekor-submit <bundle>`.
  //
  // Wire format: DSSE envelope wrapping bundle.payload canonical bytes,
  // posted as a Rekor `dsse` entry. This is the canonical Sigstore path
  // for Ed25519 signers (hashedrekord doesn't work for Ed25519). The DSSE
  // signature is computed by @sigstore/sign over PAE(payloadType, payload);
  // it is INDEPENDENT of the bundle's primary signature (which signs the
  // canonical bytes directly). Both bind to the same Ed25519 public key, so
  // a verifier walking from bundle.rekor.uuid to the Rekor entry and back
  // to the bundle's pubkey establishes the chain.
  let rekorResult: RekorSubmitResult | null = null;
  if (opts.noRekor !== true) {
    rekorResult = await submitToRekor({
      payloadBytes: new TextEncoder().encode(canonical),
      privateKey: privKey,
      publicKeyHex,
    });
  }
  const rekor: RekorEntry | null = rekorResult?.ok ? rekorResult.entry : null;

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    payload,
    hash,
    signature: `ed25519:${signatureHex}`,
    public_key: `ed25519:${pubJwk.x}`,
    ...(attestation ? { attestation } : {}),
    ...(rekor ? { rekor } : { rekor: null }),
  };

  // 3. Write bundle to disk (always to ~/.beheld/snapshots/, plus --output if given)
  const snapDir = join(dataDir(), "snapshots");
  mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  const fileName = bundleFilename(payload.created_at, hash);
  const primaryPath = join(snapDir, fileName);
  const serialized = JSON.stringify(bundle, null, 2) + "\n";
  writeFileSync(primaryPath, serialized);

  let outputPath: string | undefined;
  if (opts.output) {
    writeFileSync(opts.output, serialized);
    outputPath = opts.output;
  }

  // Convenience copy to the desktop so the user can find the bundle without
  // having to know about ~/.beheld/snapshots/. Skipped silently if the
  // target dir doesn't exist or BEHELD_NO_DESKTOP_COPY=1.
  let desktopPath: string | undefined;
  const desktop = desktopCopyDir();
  if (desktop) {
    desktopPath = join(desktop, fileName);
    try {
      writeFileSync(desktopPath, serialized);
    } catch {
      desktopPath = undefined; // silent — primary already on disk
    }
  }

  // 4. Register in DB
  let saveOk = true;
  try {
    const saveResp = await fetch(`${ENGINE_URL}/snapshot/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hash,
        previous_hash: payload.previous_hash,
        payload_json: canonical,
        bundle_path: primaryPath,
      }),
    });
    saveOk = saveResp.ok;
  } catch {
    saveOk = false;
  }

  const fp = await publicKeyFingerprint(pubJwk);
  console.log("");
  console.log(ok("Snapshot generated"));
  console.log(`     ${DIM}hash:${RESET}         ${bold(hash.slice(0, 24))}…`);
  console.log(`     ${DIM}file:${RESET}         ${primaryPath}`);
  if (desktopPath) console.log(`     ${DIM}desktop:${RESET}      ${desktopPath}`);
  if (outputPath)  console.log(`     ${DIM}copy:${RESET}         ${outputPath}`);
  console.log(`     ${DIM}signed by:${RESET}    ${fp}`);

  // F5.6 — surface GitHub identity tier inferred from the embedded attestation.
  if (attestation) {
    console.log(`     ${DIM}identity:${RESET}     @${attestation.payload.github.login} ${meta("· GitHub OAuth")}`);
  } else {
    console.log(`     ${DIM}identity:${RESET}     not verified ${meta("(run beheld identity link)")}`);
  }

  // L1 / L2 composition surfaced from the just-signed payload (Phase 6 / F6.8).
  const comp = composition(payload as unknown as Record<string, unknown>);
  console.log("");
  console.log(`  ${bold("Profile captured")}`);
  console.log(`     ${DIM}Engine:${RESET}               beheld-engine v${payload.beheld_version}`);
  if (payload.engine_version_hash) {
    console.log(`     ${DIM}Engine hash:${RESET}          ${payload.engine_version_hash.slice(0, 16)}…`);
  }
  console.log(`     ${DIM}Historical base:${RESET}      ${comp.base}`);
  console.log(`     ${DIM}Observed trajectory:${RESET}  ${comp.trajectory}`);
  console.log(`     ${DIM}Rekor:${RESET}                ${renderRekorLine(rekorResult)}`);
  console.log(`     ${DIM}Tier:${RESET}                 ${bold(computeTier(bundle))}`);

  if (!saveOk) {
    console.log("");
    console.log(warn("Bundle written to disk but not registered on the chain"));
    console.log(`     ${DIM}Run \`beheld snapshot\` again once the engine is up.${RESET}`);
  }

  if (opts.html === true) {
    await writeHtmlRetrato(bundle, primaryPath, opts.authorName);
  }

  console.log("");

  // --share: skip the prompt and publish straight away.
  // Otherwise: ask once, default N.
  let shouldShare = opts.share === true;
  if (!shouldShare) {
    shouldShare = await askPublishPrompt();
  }
  if (shouldShare) {
    const { runShare, renderShareSuccess } = await import("./share");
    const outcome = await runShare();
    if (outcome.ok && outcome.result?.ok) {
      await renderShareSuccess(outcome.result.data.url);
    }
  }
}

/** Post-generation prompt — one-liner, default N. Returns true only on an
 *  explicit affirmative ("y"). Empty input or anything else: no share. */
async function askPublishPrompt(): Promise<boolean> {
  // Skip the prompt in non-TTY contexts (CI, piped stdin) — there's no
  // human to answer, so the safe default is "do not publish".
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => {
      rl.question("→ Publish verified profile? [y/N] ", (a) => resolve(a));
    });
    const a = answer.trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

async function writeHtmlRetrato(
  bundle: Bundle,
  bundlePath: string,
  authorName: string | undefined,
): Promise<void> {
  // F6.12 / schema v4 — the bundle now embeds signals/identity/emergent in
  // its signed payload. Read them directly so the HTML faithfully renders
  // the same bytes that were signed (no live engine required to view a
  // shared snapshot). When a field is null (engine failed to produce it at
  // build time), render with a graceful fallback rather than refusing.
  const p = bundle.payload as unknown as {
    signals?: SnapshotHtmlData["signals"] | null;
    identity?: SnapshotHtmlData["identity"] | null;
    emergent?: SnapshotHtmlData["emergent"] | null;
  };

  const signals: SnapshotHtmlData["signals"] = p.signals ?? {};

  const identity: SnapshotHtmlData["identity"] = p.identity ?? {
    // Defensive fallback for bundles that lack the v4 identity field
    // (e.g. a v3 bundle re-rendered, or engine identity gen failure).
    identity_long: "Profile under construction.",
    identity_short: "Profile under construction.",
    confidence: "low",
    generation_path: "fallback",
    model_used: null,
  };

  const emergent: SnapshotHtmlData["emergent"] = p.emergent ?? null;

  const html = renderSnapshotHtml({
    bundle,
    signals,
    identity,
    emergent,
    authorName,
  });

  const htmlPath = bundlePath.replace(/\.beheld$/, ".html");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(htmlPath, html, "utf8");

  console.log("");
  console.log(ok("HTML portrait generated"));
  console.log(`     ${DIM}file:${RESET}       ${htmlPath}`);
  console.log(`     ${DIM}identity:${RESET}   ${identity.identity_long}`);
  console.log(`     ${DIM}confidence:${RESET} ${identity.confidence} ${meta(`(via ${identity.generation_path})`)}`);
}

/** F5.8.3 — Re-submit an existing bundle to Rekor and rewrite the file in
 *  place with the inclusion proof. Used when the original snapshot ran
 *  offline; promotes the bundle to `fully_verifiable` without changing the
 *  signed payload bytes. */
async function rekorSubmitExisting(bundlePath: string): Promise<void> {
  console.log(brand("registering bundle with Rekor"));
  if (!existsSync(bundlePath)) {
    console.error(fail(`file not found: ${bundlePath}`));
    process.exit(1);
  }
  let bundle: Bundle;
  try {
    bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
  } catch (e) {
    console.error(fail(`invalid JSON: ${(e as Error).message}`));
    process.exit(1);
  }
  if (bundle.rekor && bundle.rekor.logIndex) {
    console.log(arrow(`bundle already recorded — log #${bundle.rekor.logIndex}`));
    console.log(`     ${DIM}Tier:${RESET}  ${bold(computeTier(bundle))}`);
    return;
  }

  const pubB64u = stripPrefix(bundle.public_key ?? "", "ed25519:");
  if (!bundle.payload || !pubB64u) {
    console.error(fail("bundle has no payload/public_key — not submittable"));
    process.exit(1);
  }
  const pubHex = jwkXToHex(pubB64u);

  // Re-derive the Rekor signing material from the bundle's payload, same as
  // the fresh-snapshot path. Bundle.signature itself is NOT what Rekor wants:
  // we need Ed25519(SHA-512(canonical)), not Ed25519(canonical). The dev's
  // current private key must still match the bundle's public key — verify
  // that before submitting so we don't quietly produce a signature that
  // can't be cross-checked.
  await ensureKeys();
  const currentPubJwk = loadPublicJwk();
  if (currentPubJwk.x !== pubB64u) {
    console.error(fail("current key does not match the key that signed this bundle"));
    console.error(`     ${DIM}Bundle pub:  ed25519:${pubB64u.slice(0, 12)}…${RESET}`);
    console.error(`     ${DIM}Current key: ed25519:${currentPubJwk.x.slice(0, 12)}…${RESET}`);
    process.exit(1);
  }

  const canonical = payloadToCanonical(bundle.payload);
  const privKey = await loadPrivateKey();

  console.log(arrow(`submitting to ${getRekorUrl().replace(/^https?:\/\//, "")}`));
  const result = await submitToRekor({
    payloadBytes: new TextEncoder().encode(canonical),
    privateKey: privKey,
    publicKeyHex: pubHex,
  });
  if (!result.ok) {
    console.error(fail(`Rekor submission failed: ${rekorFailureLabel(result.reason, result.detail)}`));
    process.exit(1);
  }

  const updated: Bundle = { ...bundle, rekor: result.entry };
  writeFileSync(bundlePath, JSON.stringify(updated, null, 2) + "\n");
  console.log(ok("Rekor recorded"));
  console.log(`     ${DIM}log index:${RESET}       ${result.entry.logIndex}`);
  console.log(`     ${DIM}uuid:${RESET}            ${result.entry.uuid}`);
  console.log(`     ${DIM}integratedTime:${RESET}  ${result.entry.integratedTime}`);
  console.log(`     ${DIM}Tier:${RESET}            ${bold(computeTier(updated))}`);
}

export async function snapshotListCommand(): Promise<void> {
  console.log(brand("moment history"));
  let rows: SnapshotRow[];
  try {
    const r = await fetch(`${ENGINE_URL}/snapshots`);
    if (!r.ok) {
      console.error(fail(`engine returned ${r.status}`));
      console.error(`     ${DIM}Run: beheld start${RESET}`);
      process.exit(1);
    }
    rows = (await r.json()) as SnapshotRow[];
  } catch {
    console.error(fail("engine offline"));
    console.error(`     ${DIM}Run: beheld start${RESET}`);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log("");
    console.log(`  ${DIM}No snapshots yet.${RESET} Run: ${bold("beheld snapshot")}`);
    console.log("");
    return;
  }

  console.log("");
  console.log(`  ${bold(`${rows.length} snapshot(s)`)}`);
  console.log("");
  for (const row of rows) {
    const short = row.hash.slice("sha256:".length, "sha256:".length + 12);
    const date = row.created_at.slice(0, 19).replace("T", " ");
    const marker = row.previous_hash ? `${DIM}→${RESET}` : `${DIM}•${RESET}`; // • = genesis
    const path = row.bundle_path ?? `${DIM}(file removed)${RESET}`;
    console.log(`  ${marker} ${DIM}${date}${RESET}  ${short}  ${path}`);
  }
  console.log("");
}

/** Pure helpers exposed for unit tests. No I/O — safe to assert against. */
export const __test = {
  toHex,
  stripPrefix,
  jwkXToHex,
  rekorFailureLabel,
  renderRekorLine,
  bundleFilename,
};
