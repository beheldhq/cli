import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { composition, summarize, summarizeManifest, verifyBundle, verifyChain, type BundleResolver } from "../bundle/verify";
import { verifyAttestation } from "../bundle/attestation-verify";
import type { Bundle } from "../bundle/types";
import { fetchRekorEntry, parseRekorResponse, rekorEntryUrl } from "../lib/rekor";
import { computeTier } from "../lib/tier";
import { bold, fail, brand, GREEN, RED, YELLOW, DIM, RESET } from "../ui/styles";

interface VerifyOptions {
  chain?: boolean;
  verifyRekor?: boolean;
}

function snapshotsDir(): string {
  const base = process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
  return join(base, "snapshots");
}

/** Reads all .beheld files in ~/.beheld/snapshots/ and indexes by hash. */
function localResolver(): BundleResolver {
  const dir = snapshotsDir();
  const cache = new Map<string, Bundle>();
  if (existsSync(dir)) {
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith(".beheld")) continue;
      try {
        const b = JSON.parse(readFileSync(join(dir, fname), "utf8")) as Bundle;
        if (typeof b.hash === "string") cache.set(b.hash, b);
      } catch {
        // ignore unreadable / malformed files — verify reports them per-bundle
      }
    }
  }
  return async (hash: string) => cache.get(hash) ?? null;
}

function mark(ok: boolean): string {
  return ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
}

export async function verifyCommand(
  filePath: string,
  opts: VerifyOptions = {},
): Promise<void> {
  console.log(brand("checking authenticity"));
  if (!filePath) {
    console.error(fail("bundle path is required"));
    console.error(`     ${DIM}Usage: beheld verify <file.beheld>${RESET}`);
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(fail(`file not found: ${filePath}`));
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(fail(`invalid JSON: ${(e as Error).message}`));
    process.exit(1);
  }

  const result = await verifyBundle(raw);

  // R1.1 §3.3 — manifest at the top: detected schema, sections present,
  // capture_fidelity per enrichment source. NEVER grades a bundle by
  // richness — just reports what the verifier observed.
  const manifest = summarizeManifest(raw as Record<string, unknown>);
  console.log("");
  console.log(`  ${DIM}schema       ${RESET}${manifest.schemaLabel}`);
  console.log(`  ${DIM}sections     ${RESET}${manifest.sections.join(" · ") || "(none)"}`);
  if (manifest.harnessSources.length > 0) {
    const formatted = manifest.harnessSources
      .map(
        (s) =>
          `${s.harness} (${s.capture_fidelity} · ${s.sessions} session${s.sessions === 1 ? "" : "s"})`,
      )
      .join(", ");
    console.log(`  ${DIM}sources      ${RESET}${formatted}`);
  } else if (manifest.schema === "v6") {
    console.log(`  ${DIM}sources      (no enrichment — L1-only bundle)${RESET}`);
  } else {
    console.log(`  ${DIM}sources      (not tracked in ${manifest.schemaLabel})${RESET}`);
  }
  console.log("");

  console.log(`  Verification: ${filePath}`);
  console.log(`    ${mark(result.checks.schema.ok)} schema    ${result.checks.schema.reason ?? ""}`);
  console.log(`    ${mark(result.checks.hash.ok)} hash      ${result.checks.hash.reason ?? ""}`);
  console.log(`    ${mark(result.checks.signature.ok)} signature ${result.checks.signature.reason ?? ""}`);

  // Core / enrichment section status (R1.1 — was L1/L2 in Phase 6 / F6.8).
  // Internal CheckResult field names (l1_section/l2_section) preserved for
  // back-compat with downstream consumers; surface labels reflect the v6
  // canonical naming.
  const core = result.checks.l1_section;
  const enrichment = result.checks.l2_section;
  if (core.ok) {
    console.log(`    ${mark(true)} core         ${core.repo_count ?? 0} repositories`);
  } else {
    console.log(`    ${YELLOW}⚠${RESET} core         ${core.reason ?? "missing"}`);
  }
  if (enrichment.ok) {
    console.log(`    ${mark(true)} enrichment   ${enrichment.session_count ?? 0} sessions`);
  } else {
    console.log(`    ${mark(false)} enrichment   ${enrichment.reason ?? "missing"}`);
  }

  let chainOk = true;
  if (opts.chain && result.ok) {
    const chainResult = await verifyChain(raw as Bundle, localResolver());
    chainOk = chainResult.ok;
    const detail = chainResult.ok
      ? `(${chainResult.links_verified} links)`
      : chainResult.reason ?? "?";
    console.log(`    ${mark(chainResult.ok)} chain     ${detail}`);
  } else if (opts.chain) {
    console.log(`    ${YELLOW}–${RESET} chain     skipped (bundle itself failed)`);
    chainOk = false;
  }

  // Identity attestation (Phase 5 / F5.6.1). Optional — bundles without one
  // are still cryptographically valid; we just report identity_unverified.
  const attCheck = result.checks.schema.ok
    ? await verifyAttestation(raw as Bundle)
    : null;
  if (attCheck) {
    if (!attCheck.present) {
      console.log(`    ${YELLOW}–${RESET} identity  missing (bundle has no attestation — identity_unverified)`);
    } else if (!attCheck.payload_valid) {
      console.log(`    ${mark(false)} identity  ${attCheck.reason ?? "invalid payload"}`);
    } else {
      const allGood = attCheck.signature_valid && attCheck.dev_pubkey_matches && attCheck.key_status === "active";
      const gh = attCheck.github;
      const ghLabel = gh ? `${gh.login} (id=${gh.user_id})` : "?";
      console.log(`    ${mark(allGood)} identity  github: ${ghLabel}`);
      console.log(`      ${mark(attCheck.signature_valid)} platform signature${attCheck.reason && !attCheck.signature_valid ? `  ${DIM}${attCheck.reason}${RESET}` : ""}`);
      console.log(`      ${mark(!!attCheck.dev_pubkey_matches)} dev pubkey bind`);
      const status = attCheck.key_status ?? "?";
      const statusMark = status === "active" ? mark(true)
        : status === "rotated" ? `${YELLOW}~${RESET}`
        : status === "revoked" ? mark(false)
        : `${YELLOW}?${RESET}`;
      const statusDetail = status === "revoked" && attCheck.revoked_reason
        ? `  ${DIM}${attCheck.revoked_reason}${RESET}`
        : "";
      console.log(`      ${statusMark} platform key status: ${status}${statusDetail}`);
    }
  }

  // F5.8 — Rekor inclusion proof (wrapper-level, never affects payload hash).
  const bundle = raw as Bundle;
  if (bundle.rekor && typeof bundle.rekor.logIndex === "number") {
    const r = bundle.rekor;
    console.log("");
    console.log(`  Rekor inclusion:`);
    console.log(`    ${mark(true)} Log index: ${bold(`#${r.logIndex}`)}`);
    console.log(`    ${mark(true)} Timestamp: ${r.integratedTime} ${DIM}(UTC, immutable)${RESET}`);
    console.log(`    ${mark(true)} UUID: ${r.uuid}`);
    console.log(`    ${DIM}→ Verify at:${RESET} ${rekorEntryUrl(r.uuid)}`);

    if (opts.verifyRekor) {
      const remote = await fetchRekorEntry(r.uuid);
      if (!remote) {
        console.log(`    ${mark(false)} online lookup failed (network or invalid UUID)`);
      } else {
        const parsed = parseRekorResponse(remote);
        if (parsed && parsed.logIndex === r.logIndex && parsed.uuid === r.uuid) {
          console.log(`    ${mark(true)} Confirmed in the public log`);
        } else {
          console.log(`    ${mark(false)} Divergence detected — online entry doesn't match the bundle`);
        }
      }
    }
  } else {
    console.log("");
    console.log(`  ${YELLOW}–${RESET} Rekor: not recorded`);
    console.log(`    ${DIM}(run: beheld snapshot --rekor-submit <bundle>)${RESET}`);
  }

  if (result.ok) {
    const tier = computeTier(bundle);
    const comp = composition(bundle.payload as unknown as Record<string, unknown>);
    console.log("");
    console.log(`  ${summarize(bundle.payload)}`);
    console.log(`    Historical base:      ${comp.base}`);
    console.log(`    Observed trajectory:  ${comp.trajectory}`);
    console.log(`    Trust tier:           ${bold(tier)}`);
  }
  console.log("");

  if (!result.ok || !chainOk) process.exit(1);
}
