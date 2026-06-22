import type { McpTool } from "./types";

/** Resolve the engine URL at call time so a `BEHELD_ENGINE_URL` set after this
 *  module was imported (e.g. by a test's beforeAll) still takes effect. Mirrors
 *  the call-time pattern in lib/rekor.ts. */
function engineUrl(): string {
  return process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";
}

const VALID_HINTS = new Set([
  "feature_work",
  "debug",
  "refactor",
  "exploration",
  "unknown",
]);

const JSON_OPEN = "---BEHELD-JSON---";
const JSON_CLOSE = "---END-JSON---";

interface Pattern {
  id: string;
  label: string;
  evidence: string;
  metric: Record<string, number>;
  confidence: number;
  trend_30d: string;
  severity: string;
  applies_to_current_session: boolean;
}

interface CoachPayload {
  version: number;
  as_of: string;
  data_freshness: "live" | "cache" | "insufficient";
  scores: {
    overall: number;
    sessions_analyzed: number;
    [k: string]: unknown;
  };
  context_for_session: {
    current_project_category: string;
    ecosystems_recent: string[];
    session_phase_hint: string;
  };
  patterns: Pattern[];
  coaching_guidance: {
    tone: string;
    must: string[];
    must_not: string[];
    good_example: string;
    bad_example: string;
  };
  suggested_followups: string[];
}

async function fetchCoachPayload(hint: string): Promise<CoachPayload | null> {
  try {
    const r = await fetch(
      `${engineUrl()}/coach?session_hint=${encodeURIComponent(hint)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!r.ok) return null;
    return (await r.json()) as CoachPayload;
  } catch {
    return null;
  }
}

function wrap(text: string, payload: CoachPayload): string {
  return [
    text,
    "",
    JSON_OPEN,
    JSON.stringify(payload, null, 2),
    JSON_CLOSE,
  ].join("\n");
}

function formatInsufficient(payload: CoachPayload): string {
  const got = payload.scores.sessions_analyzed;
  const need = Math.max(0, 3 - got);
  const verbo = need === 1 ? "falta" : "faltam";
  const subst = need === 1 ? "sessão" : "sessões";
  const text = [
    "Beheld ainda coletando dados.",
    "",
    `${got}/3 sessões — ${verbo} ${need} ${subst}.`,
    "Continue usando o Claude Code; o coaching será habilitado automaticamente.",
  ].join("\n");
  return wrap(text, payload);
}

function formatLive(payload: CoachPayload): string {
  const lines: string[] = [
    `Beheld · coaching context (v${payload.version})`,
    "",
  ];

  if (payload.patterns.length === 0) {
    lines.push("No observable patterns right now — carry on.");
  } else {
    lines.push(`Patterns detected (${payload.patterns.length}):`);
    for (const p of payload.patterns) {
      lines.push(
        `  • ${p.label.padEnd(38)} confidence ${p.confidence.toFixed(2)}  · ${p.evidence}`,
      );
    }
  }
  lines.push("");
  // R1.2c — overall may be null when every dimension is absent.
  const overallTxt = payload.scores.overall === null ? "—/100" : `${payload.scores.overall}/100`;
  lines.push(
    `Score geral: ${overallTxt} · ${payload.scores.sessions_analyzed} sessões · ${payload.data_freshness}`,
  );

  return wrap(lines.join("\n"), payload);
}

export const beheldCoachTool: McpTool = {
  name: "beheld_coach",
  description: [
    "Returns patterns observed in the developer's real history (tool sequences, test cadence, ecosystems) with instructions for presenting actionable feedback.",
    "",
    "WHEN TO CALL:",
    "- The user asked for feedback on how they're coding ('how am I doing?', 'am I doing this right?', 'give me a diagnosis').",
    "- Start of a new feature/task when the current session's ecosystem matches known patterns.",
    "- The user invoked /beheld coach explicitly.",
    "",
    "WHEN NOT TO CALL:",
    "- Purely factual or execution task ('run the tests', 'read this file').",
    "- Already called in this conversation within the last ~20 messages.",
    "- Active debug session (user trying to resolve an error) — style feedback here interrupts.",
    "",
    "HOW TO USE THE RETURN:",
    "- Read the block between ---BEHELD-JSON--- and ---END-JSON--- as a contract.",
    "- Follow `coaching_guidance.must` and avoid everything in `must_not`.",
    "- Present AT MOST one pattern, chosen by (applies_to_current_session AND confidence >= 0.6) ORDER BY severity DESC.",
    "- If no pattern passes the filter, don't mention the tool — continue the conversation normally.",
    "- Never show the raw JSON to the user; the text above the delimiter is what the user should see if they want to inspect the raw state.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      session_hint: {
        type: "string",
        description:
          "Current session phase: 'feature_work', 'debug', 'refactor', 'exploration', or 'unknown'. The engine uses this to compute applies_to_current_session.",
        enum: ["feature_work", "debug", "refactor", "exploration", "unknown"],
      },
    },
  },
  async handler(args) {
    const raw = (args.session_hint as string | undefined) ?? "unknown";
    const hint = VALID_HINTS.has(raw) ? raw : "unknown";

    const payload = await fetchCoachPayload(hint);
    if (!payload) {
      return "Beheld: engine offline. Tente novamente em alguns segundos ou execute: beheld start.";
    }
    if (payload.data_freshness === "insufficient") {
      return formatInsufficient(payload);
    }
    return formatLive(payload);
  },
};
