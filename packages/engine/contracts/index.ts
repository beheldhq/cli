/**
 * Beheld engine HTTP contract.
 *
 * The Beheld engine is a localhost HTTP server (port 7338 by default). It is
 * the only component that reads sanitized session events, runs scoring, and
 * stores the developer profile. This file declares the public surface the
 * CLI and MCP server depend on.
 *
 * The reference implementation is proprietary and lives in a private repo
 * (beheldhq/engine). The `@beheld/engine-stub` package in this repo provides
 * a deterministic mock that satisfies this contract for local development.
 */

export const ENGINE_DEFAULT_PORT = 7338;
export const ENGINE_DEFAULT_BASE = `http://127.0.0.1:${ENGINE_DEFAULT_PORT}`;

// ── Scores & profile ────────────────────────────────────────────────────────

export interface Scores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
}

export interface ProfileSummary {
  total_sessions: number;
  platforms: string[];
  ecosystems: string[];
  workflow_distribution: Record<string, number>;
  project_categories: Record<string, number>;
  last_scored_at: string | null;
  overall_score: number;
}

export interface Insight {
  insights: string[];
  generated_at: string | null;
  model?: string;
}

// ── Engine status & readiness ───────────────────────────────────────────────

export interface EngineHealth {
  ok: boolean;
  version?: string;
}

export interface EngineStatus {
  ok: boolean;
  version: string;
  sessions_processed: number;
  unprocessed_events: number;
  last_processed_at: string | null;
}

export interface EngineReadiness {
  ready: boolean;
  sessions_count: number;
  sessions_required: number;
  sessions_remaining: number;
}

export interface ProcessResult {
  status: string;
  processed: number;
}

// ── Coach ───────────────────────────────────────────────────────────────────

export interface CoachPattern {
  id: string;
  label: string;
  evidence: string;
  metric: Record<string, number>;
  confidence: number;
  trend_30d: string;
  severity: string;
  applies_to_current_session: boolean;
}

export interface CoachPayload {
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
  patterns: CoachPattern[];
  coaching_guidance: {
    tone: string;
    must: string[];
    must_not: string[];
    good_example: string;
    bad_example: string;
  };
  suggested_followups: string[];
}

// ── L1 (git history import) ─────────────────────────────────────────────────

export interface L1ImportRequest {
  repo_url: string;
  author_email: string;
  pat?: string | null;
}

export interface L1ImportResponse {
  status: "processing";
  repo_url: string;
}

export type L1ImportResultStatus =
  | "imported"
  | "already_imported"
  | "author_not_found"
  | "needs_pat"
  | "clone_error";

export interface L1ImportResult {
  status: L1ImportResultStatus;
  root_commit_hash?: string;
  commit_count?: number;
  detail?: string;
  ecosystems?: string[];
  test_ratio?: number;
  first_commit_at?: string;
  last_commit_at?: string;
}

export interface L1ImportStatus {
  status: "idle" | "processing" | "done" | "error";
  repo_url: string | null;
  progress_pct: number;
  result: L1ImportResult | null;
}

export interface L1Repository {
  root_commit_hash: string;
  imported_at: string;
  commit_count: number;
}

// ── HTTP endpoint manifest ──────────────────────────────────────────────────
//
// Every endpoint the CLI invokes. Stub implementations and the real engine
// must respond on each path with the documented shape.
//
//   GET    /health                       → EngineHealth
//   GET    /status                       → EngineStatus
//   GET    /profile/readiness            → EngineReadiness
//   GET    /profile/summary              → ProfileSummary
//   GET    /scores/current               → Scores
//   GET    /scores/history?days=N        → Scores[]
//   GET    /insights                     → Insight
//   GET    /coach?session_hint=...       → CoachPayload
//   POST   /process                      → ProcessResult
//   POST   /l1/import                    → L1ImportResponse  (body: L1ImportRequest)
//   GET    /l1/import/status             → L1ImportStatus
//   GET    /l1/repositories              → L1Repository[]
//   DELETE /l1/repositories/{hash}       → 204 on success, 404 on miss

export const CONTRACT_VERSION = "0.5.0";
