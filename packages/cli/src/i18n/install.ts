/**
 * Minimal i18n for the install flow in the B3 voice.
 *
 * Scope is limited to this command — this is not an i18n framework. When other
 * parts of the CLI need translation, hoist to packages/cli/src/i18n/<feature>.ts
 * using the same pattern.
 */

export type Lang = "en" | "pt-br";
export const SUPPORTED_LANGS: Lang[] = ["en", "pt-br"];

interface Entry {
  en: string;
  "pt-br": string;
}

const DICT: Record<string, Entry> = {
  // Opener and closer (B3 voice)
  "install.opener": {
    en: "My name is B3H31D. I'm the observer present in the beheld.dev environment.",
    "pt-br": "Meu nome é B3H31D, sou o observador presente no ambiente do beheld.dev",
  },
  "install.closer.ok.l1": {
    en: "Done. I'm watching.",
    "pt-br": "Pronto. Estou de olho.",
  },
  "install.closer.ok.l2": {
    en: "Use `beheld doctor` to check my health.",
    "pt-br": "Use `beheld doctor` para checar minha saúde.",
  },
  "install.closer.ok.l3": {
    en: "Forever free for developers.",
    "pt-br": "Para sempre gratuito para desenvolvedores.",
  },
  "install.closer.partial.l1": {
    en: "Installed. {label} reported error.",
    "pt-br": "Instalado. {label} reportou error.",
  },
  "install.closer.partial.l2": {
    en: "Try: beheld doctor",
    "pt-br": "Tente: beheld doctor",
  },
  "install.closer.signoff": {
    en: "— B3H31D",
    "pt-br": "— B3H31D",
  },

  // Sections
  "install.section.preflight": { en: "pre-flight", "pt-br": "pré-flight" },
  "install.section.install": { en: "install", "pt-br": "instalação" },
  "install.section.verify": { en: "verification", "pt-br": "verificação" },

  // Pre-flight labels
  "install.preflight.platform": { en: "platform", "pt-br": "plataforma" },
  "install.preflight.dataDir": { en: "~/.beheld/ available", "pt-br": "~/.beheld/ disponível" },
  "install.preflight.migrate": {
    en: "project registrations clean",
    "pt-br": "registros de projeto verificados",
  },

  // Install labels
  "install.install.engine": {
    en: "engine binary extracted",
    "pt-br": "engine binary extraído",
  },
  "install.install.claudeHooks": {
    en: "Claude Code hooks registered",
    "pt-br": "hooks do Claude Code registrados",
  },
  "install.install.continueMcp": {
    en: "Continue.dev MCP registered",
    "pt-br": "MCP do Continue.dev registrado",
  },
  "install.install.autostart": { en: "autostart installed", "pt-br": "autostart instalado" },
  "install.install.start": { en: "daemons started", "pt-br": "daemons iniciados" },

  // Verify labels
  "install.verify.mcp": { en: "MCP server", "pt-br": "MCP server" },
  "install.verify.engine": { en: "Scoring engine", "pt-br": "Scoring engine" },
  "install.verify.autostart": { en: "Autostart", "pt-br": "Autostart" },
  "install.verify.jsonl": { en: "JSONL pipeline", "pt-br": "JSONL pipeline" },

  // Detail/error meta
  "install.error.reason": { en: "reason", "pt-br": "motivo" },
  "install.error.see": { en: "see", "pt-br": "ver" },

  // Counter — first install. Appears ONCE in a lifetime, between the opener
  // and the first `· pre-flight`. When BEHELD_NO_TELEMETRY=1 is set, none
  // of this is printed (invisible opt-out).
  "counter.heading": {
    en: "Registering first install with beheld.dev",
    "pt-br": "Registrando primeira instalação com beheld.dev",
  },
  "counter.sent": { en: "sent", "pt-br": "enviado" },
  "counter.disable": {
    en: "to disable in future: BEHELD_NO_TELEMETRY=1",
    "pt-br": "desliga futuras: BEHELD_NO_TELEMETRY=1",
  },
};

/**
 * Lookup with simple `{var}` interpolation.
 * Missing key → returns the key itself (so it's visible during review).
 */
export function t(key: string, lang: Lang, vars?: Record<string, string>): string {
  const entry = DICT[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(v);
    }
  }
  return text;
}

export function isLang(s: string): s is Lang {
  return s === "en" || s === "pt-br";
}
