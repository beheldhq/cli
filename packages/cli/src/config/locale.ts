/**
 * Locale detection for the notify-channel feature. The CLI itself doesn't
 * have an i18n framework — strings stay PT-BR inline. The only consumer
 * of this helper is `authenticatedFetch`, which injects `Accept-Language`
 * so the portal can pick the right template when sending emails.
 *
 * Module 3 of 6 — `cli/bootstrap-and-share-prompts`.
 * Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).
 */

export type SupportedLocale = "pt-BR" | "en" | "es";

const SUPPORTED: ReadonlyArray<SupportedLocale> = ["pt-BR", "en", "es"];

/** Best-effort match from environment locale tags to one of the three
 *  supported portal locales. Default: `en` — the safest fallback for an
 *  international dev tool. */
export function detectLocale(env: NodeJS.ProcessEnv = process.env): SupportedLocale {
  const raw = (env.LC_ALL || env.LANG || env.LANGUAGE || "").toLowerCase();
  if (raw.startsWith("pt")) return "pt-BR";
  if (raw.startsWith("es")) return "es";
  return "en";
}

/** Returns a well-formed Accept-Language header with quality factors:
 *  primary at q=1.0 (implicit), then the other supported locales as
 *  fallbacks at q=0.9 and q=0.8. Order is stable so callers can snapshot. */
export function acceptLanguageHeader(env: NodeJS.ProcessEnv = process.env): string {
  const primary = detectLocale(env);
  const fallbacks = SUPPORTED.filter((l) => l !== primary);
  return `${primary},${fallbacks[0]};q=0.9,${fallbacks[1]};q=0.8`;
}
