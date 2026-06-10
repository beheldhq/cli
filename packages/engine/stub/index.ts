/**
 * Beheld engine — deterministic stub.
 *
 * Runs an HTTP server on localhost:7338 that satisfies the engine HTTP
 * contract declared in @beheld/engine-contracts. Returns fixed, plausible
 * data so the CLI can be developed without the proprietary scoring engine.
 *
 * Start with:  bun run packages/engine/stub/index.ts
 * Or:          bun run stub:engine          (from the workspace root)
 */

import {
  CONTRACT_VERSION,
  ENGINE_DEFAULT_PORT,
  type CoachPayload,
  type EngineHealth,
  type EngineReadiness,
  type EngineStatus,
  type Insight,
  type L1ImportResponse,
  type L1ImportStatus,
  type L1Repository,
  type ProcessResult,
  type ProfileSummary,
  type Scores,
} from "@beheld/engine-contracts";

const PORT = Number(process.env.BEHELD_ENGINE_PORT ?? ENGINE_DEFAULT_PORT);
const VERSION = `${CONTRACT_VERSION}-stub`;
const STARTED_AT = new Date("2026-06-10T00:00:00Z").toISOString();

const SCORES: Scores = {
  prompt_quality: 72,
  test_maturity: 64,
  tech_breadth: 81,
  growth_rate: 58,
  overall: 69,
  sessions_analyzed: 42,
  updated_at: STARTED_AT,
};

const SUMMARY: ProfileSummary = {
  total_sessions: 42,
  platforms: ["macOS", "Linux"],
  ecosystems: ["typescript", "python", "rust"],
  workflow_distribution: { build: 18, debug: 14, test: 7, refactor: 3 },
  project_categories: { backend: 22, cli: 12, web: 8 },
  last_scored_at: STARTED_AT,
  overall_score: 69,
};

const INSIGHT: Insight = {
  insights: [
    "Your prompt quality is trending up — keep providing concrete acceptance criteria.",
    "Test maturity lags backend output; consider one TDD session per feature.",
  ],
  generated_at: STARTED_AT,
  model: "stub",
};

const COACH: CoachPayload = {
  version: 1,
  as_of: STARTED_AT,
  data_freshness: "live",
  scores: { overall: 69, sessions_analyzed: 42 },
  context_for_session: {
    current_project_category: "backend",
    ecosystems_recent: ["typescript", "python"],
    session_phase_hint: "build",
  },
  patterns: [],
  coaching_guidance: {
    tone: "neutral",
    must: ["state the acceptance criteria up front"],
    must_not: ["paste the entire file when only a function changed"],
    good_example: "Refactor parse() to return Result<T,E>; tests in fixtures/parser.test.ts cover edge cases.",
    bad_example: "Fix the bug.",
  },
  suggested_followups: ["beheld view", "beheld coach --explain"],
};

function ok<T>(body: T): Response {
  return Response.json(body);
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();

    if (method === "GET" && pathname === "/health") {
      return ok<EngineHealth>({ ok: true, version: VERSION });
    }

    if (method === "GET" && pathname === "/status") {
      return ok<EngineStatus>({
        ok: true,
        version: VERSION,
        sessions_processed: SCORES.sessions_analyzed,
        unprocessed_events: 0,
        last_processed_at: STARTED_AT,
      });
    }

    if (method === "GET" && pathname === "/profile/readiness") {
      return ok<EngineReadiness>({
        ready: true,
        sessions_count: SCORES.sessions_analyzed,
        sessions_required: 5,
        sessions_remaining: 0,
      });
    }

    if (method === "GET" && pathname === "/profile/summary") {
      return ok<ProfileSummary>(SUMMARY);
    }

    if (method === "GET" && pathname === "/scores/current") {
      return ok<Scores>(SCORES);
    }

    if (method === "GET" && pathname === "/scores/history") {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? "30")));
      const history: Scores[] = Array.from({ length: days }, (_, i) => ({
        ...SCORES,
        updated_at: new Date(Date.parse(STARTED_AT) - (days - 1 - i) * 86_400_000).toISOString(),
      }));
      return ok(history);
    }

    if (method === "GET" && pathname === "/insights") {
      return ok<Insight>(INSIGHT);
    }

    if (method === "GET" && pathname === "/coach") {
      return ok<CoachPayload>(COACH);
    }

    if (method === "POST" && pathname === "/process") {
      return ok<ProcessResult>({ status: "ok", processed: 0 });
    }

    if (method === "POST" && pathname === "/l1/import") {
      return ok<L1ImportResponse>({ status: "processing", repo_url: "stub://repo" });
    }

    if (method === "GET" && pathname === "/l1/import/status") {
      return ok<L1ImportStatus>({
        status: "idle",
        repo_url: null,
        progress_pct: 0,
        result: null,
      });
    }

    if (method === "GET" && pathname === "/l1/repositories") {
      return ok<L1Repository[]>([]);
    }

    if (method === "DELETE" && pathname.startsWith("/l1/repositories/")) {
      return new Response(null, { status: 204 });
    }

    return notFound();
  },
});

console.log(`[engine-stub] listening on http://127.0.0.1:${server.port} (contract ${CONTRACT_VERSION})`);
