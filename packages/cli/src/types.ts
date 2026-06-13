export interface Scores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
}

export interface DaemonStatus {
  running: boolean;
  session_active: boolean;
  events_today: number;
  sessions_today: number;
  pid: number;
}

export interface SessionMetrics {
  active: boolean;
  session_id?: string;
  duration_minutes?: number;
  event_count?: number;
  tools_used?: string[];
  has_test_context?: boolean;
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

export interface ProcessResult {
  status: string;
  processed: number;
}

export interface ProfileData {
  scores: Scores | null;
  summary: ProfileSummary | null;
  insights: string[];
  session: SessionMetrics | null;
}

export interface ViewFlags {
  json: boolean;
  scoresOnly: boolean;
}

export interface WizardDimensions {
  prompt_quality: boolean;
  test_maturity: boolean;
  tech_breadth: boolean;
  work_hours: boolean;
  project_type: boolean;
}

export interface WizardEnvironments {
  claudeCode: boolean;
  continueDev: boolean;
}

export interface TelemetryConfig {
  /** "granted" = ping allowed; "denied" = never ping; "unset" = never
   *  asked (CI / first-run scripts default here). */
  consent: "granted" | "denied" | "unset";
  /** ISO-8601 timestamp of when the user answered the consent prompt.
   *  Null when never asked. */
  consented_at: string | null;
}

export interface BeheldConfig {
  version: string;
  initialized_at: string;
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
  /** Author email used to filter commits during L1 import. */
  author_email?: string;
  /** Bitbucket username (public identifier, NOT a credential). Cached so the
   *  user doesn't retype it on every `beheld import --bitbucket`. */
  bitbucket_username?: string;
  /** Slug returned by the portal on the most recent successful publish.
   *  Used to detect first-publish state and to print the public URL. */
  last_published_slug?: string;
  /** Recovery email registered with the portal on first publish. Local
   *  cache only — the source of truth lives in Account.email_recovery. */
  email_recovery?: string;
  /** Anonymous platform ping consent. See lib/telemetry-config.ts. */
  telemetry?: TelemetryConfig;

  // ── Notify channel (módulo cli/notify-commands) ───────────────────────────
  // Local cache of the developer communication email channel. Source of
  // truth lives in the portal (`Account.account_emails` + `NotifyPreferences`)
  // — these fields exist so the CLI can render `notify status` and decide
  // whether to enqueue a digest signal without a round-trip.
  // Spec canônica: produto/analise/analise-email-comunicacao.md (rodada 5).

  /** Email registered for product notifications (bundle events + weekly
   *  digest). Distinct from `email_recovery` — the legacy recovery email
   *  cache is kept untouched for backward compat. */
  notification_email?: NotifyEmailRecord;

  /** Per-purpose recovery email record. Mirrors `notification_email` shape
   *  but for the security/recovery purpose. */
  recovery_email?: NotifyEmailRecord;

  /** Granular consents. Defaults: security/recovery on, bundle_events/weekly
   *  off — matches the portal's NotifyPreferences defaults. */
  notify_consents?: NotifyConsents;

  /** Local view of the weekly digest schedule. `next_signal_at` is computed
   *  client-side when `weekly` is freshly enabled so the daemon (module 5)
   *  knows when to send the next digest signal. */
  notify_weekly?: NotifyWeeklyState;

  /** What to do for a weekly cycle with no score delta. Default: "notify"
   *  (short email registering the silence). */
  notify_silent_weeks_policy?: "notify" | "skip";

  /** True after the second-stage consent offer (post-`--share`) has been
   *  shown. Single-shot — recusa não retorna (módulo 3). */
  notify_secondary_offer_shown?: boolean;
}

export interface NotifyEmailRecord {
  value: string;
  verified: boolean;
  verified_at: string | null;
}

export interface NotifyConsents {
  security: boolean;
  recovery: boolean;
  bundle_events: boolean;
  weekly: boolean;
}

export interface NotifyWeeklyState {
  enabled: boolean;
  delta_threshold: number;
  last_signal_payload: object | null;
  last_signal_sent_at: string | null;
  next_signal_at: string | null;
}

export interface L1ImportResponse {
  status: "processing";
  repo_url: string;
}

export interface L1ImportStatus {
  status: "idle" | "processing" | "done" | "error";
  repo_url: string | null;
  progress_pct: number;
  result:
    | null
    | {
        status:
          | "imported"
          | "already_imported"
          | "author_not_found"
          | "needs_pat"
          | "clone_error";
        root_commit_hash?: string;
        commit_count?: number;
        detail?: string;
        ecosystems?: string[];
        test_ratio?: number;
        first_commit_at?: string;
        last_commit_at?: string;
      };
}

export interface L1Repository {
  root_commit_hash: string;
  imported_at: string;
  commit_count: number;
}

// ── F6.11 — listing + selective import per host ─────────────────────────────

export type HostName = "github" | "gitlab" | "bitbucket";

/** Credential obtained for the LISTING API. Never persisted, never reused for
 *  clone — clone goes through the engine's F6.3 auth cascade. */
export type HostToken =
  | { method: "cli"; token: string; host: "github" | "gitlab" }
  | { method: "pat"; token: string; host: HostName }
  | {
      method: "app_password";
      username: string;
      app_password: string;
      host: "bitbucket";
    };

/** Unified repo shape returned by every host listing client. */
export interface RemoteRepo {
  full_name: string;
  clone_url_https: string;
  clone_url_ssh: string;
  language: string | null;
  last_pushed_at: string;
  is_private: boolean;
}

export interface HostImportSummary {
  imported: number;
  already_existing: number;
  no_commits: number;
  failed: number;
  total_commits: number;
}

/** Terminal outcome of one repo passing through the engine ingest pipeline.
 *  The orchestrator reports these counts back to the user. */
export type ImportResultKind =
  | "imported"
  | "already_existing"
  | "no_commits"
  | "failed";

export interface ImportResult {
  kind: ImportResultKind;
  /** Commits attributed to the author — only meaningful when kind === "imported". */
  commits: number;
}
