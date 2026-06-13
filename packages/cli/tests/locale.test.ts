/**
 * Module 3 — bootstrap-and-share-prompts. Tests for config/locale.ts.
 */
import { describe, expect, test } from "bun:test";

import { acceptLanguageHeader, detectLocale } from "../src/config/locale";

describe("detectLocale", () => {
  test("pt_BR.UTF-8 → pt-BR", () => {
    expect(detectLocale({ LANG: "pt_BR.UTF-8" })).toBe("pt-BR");
  });
  test("en_US.UTF-8 → en", () => {
    expect(detectLocale({ LANG: "en_US.UTF-8" })).toBe("en");
  });
  test("es_ES.UTF-8 → es", () => {
    expect(detectLocale({ LANG: "es_ES.UTF-8" })).toBe("es");
  });
  test("no env vars → en", () => {
    expect(detectLocale({})).toBe("en");
  });
  test("LC_ALL wins over LANG", () => {
    expect(detectLocale({ LC_ALL: "pt_BR.UTF-8", LANG: "en_US.UTF-8" })).toBe("pt-BR");
  });
  test("unknown tag → en (safe fallback)", () => {
    expect(detectLocale({ LANG: "ja_JP.UTF-8" })).toBe("en");
  });
});

describe("acceptLanguageHeader", () => {
  test("primary first, fallbacks with quality factors", () => {
    expect(acceptLanguageHeader({ LANG: "pt_BR.UTF-8" })).toBe("pt-BR,en;q=0.9,es;q=0.8");
    expect(acceptLanguageHeader({ LANG: "en_US.UTF-8" })).toBe("en,pt-BR;q=0.9,es;q=0.8");
    expect(acceptLanguageHeader({ LANG: "es_ES.UTF-8" })).toBe("es,pt-BR;q=0.9,en;q=0.8");
  });
});
