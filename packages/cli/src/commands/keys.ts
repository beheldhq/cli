import { existsSync } from "node:fs";

import {
  ensureKeys,
  getKeyPaths,
  importPrivateKey,
  keysExist,
  loadPublicJwk,
  publicKeyFingerprint,
  rotateKeys,
} from "../keys/keystore";
import { ok, fail, warn, meta, bold, brand, DIM, RESET } from "../ui/styles";

export async function keysShowCommand(): Promise<void> {
  console.log(brand("your signing key"));
  const paths = getKeyPaths();
  if (!keysExist()) {
    console.error(fail("no Ed25519 key found"));
    console.error(`     ${DIM}Run: beheld init  ${meta("(generates the pair automatically)")}${RESET}`);
    console.error(`     ${DIM}Or: beheld keys import <file>${RESET}`);
    process.exit(1);
  }
  const pub = loadPublicJwk();
  const fp = await publicKeyFingerprint(pub);

  console.log("");
  console.log(`  ${bold("Public key")} ${meta("(Ed25519, JWK)")}`);
  console.log(`     ${DIM}x:${RESET}           ${pub.x}`);
  console.log(`     ${DIM}fingerprint:${RESET} ${bold(fp)}`);
  console.log(`     ${DIM}path:${RESET}        ${paths.publicPath}`);
  console.log("");
}

export async function keysImportCommand(sourcePath: string): Promise<void> {
  console.log(brand("adding a key"));
  if (!sourcePath) {
    console.error(fail("key path is required"));
    console.error(`     ${DIM}Usage: beheld keys import <file>${RESET}`);
    process.exit(1);
  }
  if (!existsSync(sourcePath)) {
    console.error(fail(`file not found: ${sourcePath}`));
    process.exit(1);
  }

  if (keysExist()) {
    console.error(warn("a key is already installed"));
    console.error(`     ${DIM}Use \`beheld keys rotate\` before importing — the current key is archived.${RESET}`);
    process.exit(1);
  }

  try {
    const paths = await importPrivateKey(sourcePath);
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log(ok("Ed25519 key imported"));
    console.log(`     ${DIM}fingerprint:${RESET} ${bold(fp)}`);
    console.log(`     ${DIM}private:${RESET}     ${paths.privatePath}  ${meta("(0600)")}`);
    console.log(`     ${DIM}public:${RESET}      ${paths.publicPath}   ${meta("(0644)")}`);
    console.log("");
  } catch (err) {
    console.error(fail(`failed to import: ${(err as Error).message}`));
    process.exit(1);
  }
}

export async function keysRotateCommand(): Promise<void> {
  console.log(brand("rotating your keys"));
  if (!keysExist()) {
    console.error(fail("no keys to rotate"));
    console.error(`     ${DIM}Run: beheld init${RESET}`);
    process.exit(1);
  }

  try {
    const { archived } = await rotateKeys();
    const pub = loadPublicJwk();
    const fp = await publicKeyFingerprint(pub);
    console.log("");
    console.log(ok("Key pair rotated"));
    console.log(`     ${DIM}new fingerprint:${RESET} ${bold(fp)}`);
    console.log(`     ${DIM}archived file:${RESET}   ${archived}`);
    console.log("");
    console.log(`  ${meta("Old snapshots remain verifiable with the public_key embedded in them.")}`);
    console.log("");
  } catch (err) {
    console.error(fail(`failed to rotate: ${(err as Error).message}`));
    process.exit(1);
  }
}

/** Hook used by `beheld init` — silent if keys already exist. */
export async function ensureKeysSilent(): Promise<{ created: boolean }> {
  const result = await ensureKeys();
  return { created: result.created };
}
