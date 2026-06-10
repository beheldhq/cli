import { test, expect, describe } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SLASH_COMMAND_CONTENT,
  SLASH_COMMAND_VERSION,
  installClaudeSlashCommand,
} from "../src/config/hooks";

function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "beheld-slash-"));
  return join(dir, name);
}

const LEGACY_V1_BODY =
  'Use the beheld MCP tool with view="$ARGUMENTS" (use "summary" if no argument given) and display the result exactly as returned, without adding any commentary.\n';

const LEGACY_V2_BODY = `---
version: "2"
---
Antes de qualquer resposta, apresente-se com exatamente esta frase,
substituindo [nome] pelo nome do usuário desta sessão do Claude
(você tem acesso a essa informação no contexto da conversa):

  "Meu nome é B3H31D, sou a testemunha da evolução do perfil de [nome]."

Em seguida, aplique as regras de roteamento abaixo com base em: $ARGUMENTS

Regras de roteamento (aplique exatamente — não interprete nem adicione conteúdo):

1. Se "$ARGUMENTS" começar com "import " (com espaço após "import"):
   → Extraia tudo após "import " como a URL
   → Chame a tool \`beheld\` com: action="import", url=<url extraída>

2. Se "$ARGUMENTS" for exatamente "import" (sem nada após):
   → Chame a tool \`beheld\` com: action="import", url=""

3. Em qualquer outro caso (vazio, "summary", "scores", "insights", "full", etc.):
   → Chame a tool \`beheld\` com: action="view", view="$ARGUMENTS" (ou "summary" se vazio)

Retorne a saudação + exatamente o que a tool retornar. Não adicione mais nada.
`;

const LEGACY_V3_BODY = `---
version: "3"
---
Antes de qualquer resposta, apresente-se com exatamente esta frase,
substituindo [nome] pelo nome do usuário desta sessão do Claude
(você tem acesso a essa informação no contexto da conversa):

  "Meu nome é B3H31D. Vou testemunhar a evolução do perfil de [nome]."

Em seguida, aplique as regras de roteamento abaixo com base em: $ARGUMENTS

Regra 1 — Modo conversacional b3:
  algum conteúdo antigo

Regra 4 — View (padrão):
  algum conteúdo antigo
`;

describe("installClaudeSlashCommand — versioning", () => {
  test("test_slash_command_version_4_written_on_fresh_install", async () => {
    const file = tmpFile("beheld.md");
    expect(existsSync(file)).toBe(false);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_VERSION).toBe("7");
  });

  test("test_slash_command_version_1_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V1_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).not.toContain(LEGACY_V1_BODY.trim());
  });

  test("test_slash_command_version_2_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V2_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).toMatch(/^---\nversion: "7"\n---\n/);
    // Old greeting and old "Retorne a saudação" trailer must be gone.
    expect(content).not.toContain("sou a testemunha da evolução");
    expect(content).not.toContain("Retorne a saudação");
  });

  test("test_slash_command_version_3_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(file, LEGACY_V3_BODY);

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(content).toMatch(/^---\nversion: "7"\n---\n/);
    // v3 had no stack routing — v4 must introduce it.
    expect(content).toContain("Rule 4 — Stack");
  });

  test("test_slash_command_version_1_frontmatter_overwritten_on_init", async () => {
    const file = tmpFile("beheld.md");
    writeFileSync(
      file,
      '---\nversion: "1"\n---\nour old content\n',
    );

    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
  });

  test("test_slash_command_content_contains_b3_routing_rule", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("Rule 1 — Conversational b3 mode");
    expect(content).toContain('"b3 "');
    expect(content).toContain('"B3 "');
    expect(content).toContain("case-insensitive");
    // b3 must precede import in the routing order so that "b3 import ..." is
    // routed to conversational mode, not to import.
    const b3Index = content.indexOf("Rule 1");
    const importIndex = content.indexOf("Rule 2");
    expect(b3Index).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(b3Index);
  });

  test("test_slash_command_content_contains_response_template", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    // v5: removed the blockquote (>) to avoid italic render in the CLI.
    expect(content).toContain("-(·⊙·)-");
    // v7: template uses "[3rd-person verb]" because bold B3H31D is the subject.
    expect(content).toContain("**B3H31D** [3rd-person verb]");
    // Decoration + blank line + B3H31D paragraph, without blockquote prefix.
    expect(content).toMatch(/-\(·⊙·\)-\n\s*\n\s*\*\*B3H31D\*\*/);
    // v6: absolute rule against italic — literal quote of the prohibitions.
    expect(content).toContain("ZERO ITALICS");
  });

  test("test_slash_command_content_contains_signal_symbol", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("-(·⊙·)-");
    // v7: the decoration appears 2 times — once in the template and once in
    // the CORRECT EXAMPLE. This is the fixed expected count; more or less indicates drift.
    const occurrences = content.split("-(·⊙·)-").length - 1;
    expect(occurrences).toBe(2);
    // Make sure the old decoration did not leak.
    expect(content).not.toContain("─ ( · · · ⊙ · · · ) ─");
  });

  test("test_slash_command_content_contains_version_7_frontmatter", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain('version: "7"');
  });

  test("test_slash_command_content_contains_greeting_instruction", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain(
      "My name is B3H31D. I will witness the evolution of [name]'s profile.",
    );
    expect(content).toContain("[name]");
    expect(content).toContain("Before any response");
    expect(content).not.toMatch(/eduardo/i);
  });

  test("test_slash_command_content_contains_stack_routing", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("Rule 4 — Stack");
    expect(content).toContain('action="stack"');
    // All four trigger keywords.
    expect(content).toContain('"stack"');
    expect(content).toContain('"languages"');
    expect(content).toContain('"frameworks"');
    expect(content).toContain('"architecture"');
    // Stack must come before the fallback view rule (otherwise the keywords
    // would always be swallowed by view).
    const stackIdx = content.indexOf("Rule 4 — Stack");
    const viewIdx = content.indexOf("Rule 5 — View");
    expect(stackIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeGreaterThan(stackIdx);
  });

  test("test_slash_command_import_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain('action="import"');
    expect(content).toContain('url=<extracted url>');
    expect(content).toContain('url=""');
    expect(content).toContain("Rule 2 — Import with URL");
    expect(content).toContain("Rule 3 — Import without URL");
  });

  test("test_slash_command_view_routing_preserved", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const content = readFileSync(file, "utf-8");
    expect(content).toContain('action="view"');
    expect(content).toContain('view="$ARGUMENTS"');
    // View is now Rule 5 (renumbered when stack was inserted as Rule 4).
    expect(content).toContain("Rule 5 — View (default)");
    expect(content).toContain('"summary"');
  });

  test("test_slash_command_content_snapshot", async () => {
    // Hard snapshot — any change to SLASH_COMMAND_CONTENT must also bump
    // SLASH_COMMAND_VERSION (so previously-installed copies get overwritten)
    // and update this snapshot. If you got here from a content edit, do both
    // before suppressing the failure.
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);

    const onDisk = readFileSync(file, "utf-8");
    expect(onDisk).toBe(SLASH_COMMAND_CONTENT);

    expect(SLASH_COMMAND_CONTENT).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(SLASH_COMMAND_CONTENT).toMatch(/^---\nversion: "7"\n---\n/);
    expect(SLASH_COMMAND_CONTENT).toContain("B3H31D");
    // v5: visual invariants
    expect(SLASH_COMMAND_CONTENT).toContain("-(·⊙·)-");
    expect(SLASH_COMMAND_CONTENT).not.toContain("> ─");
    // v6: absolute rule against italic — explicit prohibitions for each
    // form of markup that could render as italic.
    expect(SLASH_COMMAND_CONTENT).toContain("ZERO ITALICS");
    expect(SLASH_COMMAND_CONTENT).toContain("single asterisk");
    expect(SLASH_COMMAND_CONTENT).toContain("underscore");
    expect(SLASH_COMMAND_CONTENT).toContain("blockquote");
    expect(SLASH_COMMAND_CONTENT).toContain("<em>");
    expect(SLASH_COMMAND_CONTENT).toContain("quotes");
    // v7: "subject only once" rule — bold B3H31D is the subject of the first
    // sentence; the body of the response NEVER repeats the name. We use regex
    // because the prompt has line wrap that splits "name" and "B3H31D" across lines.
    expect(SLASH_COMMAND_CONTENT).toMatch(/NEVER repeat the name\s+"B3H31D" in the body/);
    expect(SLASH_COMMAND_CONTENT).toContain("CORRECT EXAMPLE");
    expect(SLASH_COMMAND_CONTENT).toContain("WRONG EXAMPLE");
    // The wrong example contains the exact anti-pattern so it stays visible in review
    // and so the model can recognize and avoid it.
    expect(SLASH_COMMAND_CONTENT).toContain("**B3H31D** B3H31D notices");
    // Five routing rules: "Rule 1" through "Rule 5".
    expect(SLASH_COMMAND_CONTENT).toContain("Rule 1");
    expect(SLASH_COMMAND_CONTENT).toContain("Rule 2");
    expect(SLASH_COMMAND_CONTENT).toContain("Rule 3");
    expect(SLASH_COMMAND_CONTENT).toContain("Rule 4");
    expect(SLASH_COMMAND_CONTENT).toContain("Rule 5");
  });

  test("preserves user-customized content without legacy signature", async () => {
    const file = tmpFile("beheld.md");
    const original = "User-customized content — do not touch.\n";
    writeFileSync(file, original);

    await installClaudeSlashCommand(file);

    expect(readFileSync(file, "utf-8")).toBe(original);
  });

  test("leaves v4 file untouched on subsequent install", async () => {
    const file = tmpFile("beheld.md");
    await installClaudeSlashCommand(file);
    const first = readFileSync(file, "utf-8");

    await installClaudeSlashCommand(file);
    const second = readFileSync(file, "utf-8");

    expect(second).toBe(first);
  });
});
