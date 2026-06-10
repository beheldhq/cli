import { coach, scoresCurrent, profileSummary, insights, engineStatus, processNew, readiness } from "../client/engine-client";
import { mcpSessionCurrent, mcpStatus } from "../client/mcp-client";
import { renderCoachText } from "../ui/coach-view";
import { renderProfile, renderCollecting } from "../ui/profile-view";
import { renderAlertBox } from "../ui/alert-box";
import { brand } from "../ui/styles";
import type { ProfileData, ViewFlags } from "../types";

interface ViewOptions {
  json?: boolean;
  scoresOnly?: boolean;
  refresh?: boolean;
  coach?: boolean;
  sessionHint?: string;
}

// In machine-readable modes (--json, --scores-only) diagnostic messages go to
// stderr so stdout stays clean for piping into jq, python3, etc.
function isRaw(flags: ViewFlags): boolean {
  return flags.json === true || flags.scoresOnly === true;
}

function warn(msg: string, flags: ViewFlags): void {
  if (isRaw(flags)) {
    process.stderr.write(msg + "\n");
  } else {
    console.log(msg);
  }
}

function warnWrite(msg: string, flags: ViewFlags): void {
  if (isRaw(flags)) {
    process.stderr.write(msg);
  } else {
    process.stdout.write(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALID_HINTS = new Set([
  "feature_work",
  "debug",
  "refactor",
  "exploration",
  "unknown",
]);

async function renderCoachView(sessionHint: string, flags: ViewFlags): Promise<void> {
  const hint = VALID_HINTS.has(sessionHint) ? sessionHint : "unknown";
  const payload = await coach(hint);
  if (!payload) {
    warn("\n  ✗ Engine offline — coaching context unavailable.", flags);
    warn("  Run: beheld start\n", flags);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log(renderCoachText(payload));
}

function formatBrazilianDate(iso: string | null): string {
  if (!iso) return "unknown date";
  // Accept ISO date or full timestamp; use only the date part
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

async function maybeRenderStaleAlert(
  source: "live" | "cache",
  updatedAt: string | null,
): Promise<void> {
  // Score "date" stores the local-day-equivalent UTC date — when the user is
  // east of UTC (e.g. GMT-3) a fresh score generated late at night UTC reads
  // as "tomorrow" relative to local. Tolerate up to 1 day diff in either
  // direction so we don't flag the boundary case as stale.
  const cacheDate = updatedAt && updatedAt.length >= 10 ? updatedAt.slice(0, 10) : null;
  const today = new Date();
  let isStale = false;
  if (cacheDate !== null) {
    const [cy, cm, cd] = cacheDate.split("-").map(Number);
    const cacheMs = Date.UTC(cy, cm - 1, cd);
    const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.abs(cacheMs - todayMs) / (24 * 3600 * 1000);
    isStale = diffDays > 1;
  }
  const isOffline = source === "cache";

  if (!isOffline && !isStale) return;

  const status = await mcpStatus();
  const eventsToday = status?.events_today;

  const title = isOffline ? "ENGINE OFFLINE" : "SCORE OUT OF DATE";
  const body: string[] = [];
  body.push(`You're viewing cache from ${formatBrazilianDate(updatedAt)}.`);
  if (eventsToday !== undefined && eventsToday > 0) {
    body.push(`${eventsToday} collected events may be pending.`);
  }

  console.log("");
  console.log(renderAlertBox({
    title,
    body,
    suggestions: [
      { label: "To diagnose", command: "beheld doctor" },
      { label: "To restart",  command: "beheld restart" },
    ],
  }));
  console.log("");
}

async function waitForProcessing(timeoutMs = 30_000, intervalMs = 1_000): Promise<"done" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const s = await engineStatus();
    if (!s || s.unprocessed_events === 0) return "done";
  }
  return "timeout";
}

export async function viewCommand(opts: ViewOptions = {}): Promise<void> {
  const flags: ViewFlags = {
    json: opts.json ?? false,
    scoresOnly: opts.scoresOnly ?? false,
  };

  if (opts.coach === true) {
    if (!flags.json && !flags.scoresOnly) console.log(brand("looking at your day up close"));
    await renderCoachView(opts.sessionHint ?? "unknown", flags);
    return;
  }

  if (!flags.json && !flags.scoresOnly) {
    console.log(brand("your portrait today"));
  }

  const status = await engineStatus();
  const hasOrphans = status !== null && status.unprocessed_events > 0;

  if (opts.refresh) {
    if (!hasOrphans) {
      warn("\n  No pending events. Score is already up to date.\n", flags);
    } else {
      warnWrite(
        `\n  Processing ${status.unprocessed_events} bytes of pending events...`,
        flags,
      );
      await processNew();
      const result = await waitForProcessing();
      if (result === "done") {
        warnWrite(" ✓\n\n", flags);
      } else {
        warnWrite("\n", flags);
        warn("  ⚠️  Processing still in progress (30s timeout).", flags);
        warn("  The displayed score may be partially updated.\n", flags);
      }
    }
  } else if (hasOrphans) {
    warn(`\n  ⚠️  Unprocessed events present (interrupted session).`, flags);
    warn(`  Score may be out of date.`, flags);
    warn(`  Run: beheld view --refresh to update.\n`, flags);
  }

  const [scores, summary, insightData, session] = await Promise.all([
    scoresCurrent(),
    profileSummary(),
    insights(),
    mcpSessionCurrent(),
  ]);

  if (!scores) {
    warn("\n  ✗ Engine offline and no cached score available.", flags);
    warn("  Run: beheld start\n", flags);
    process.exit(1);
  }

  // Only check readiness when scores are live — cache proves a profile existed before
  if (scores.source === "live" && !flags.json && !flags.scoresOnly) {
    const r = await readiness();
    if (r && !r.ready) {
      renderCollecting(r.sessions_count, r.sessions_required);
      process.exit(0);
    }
  }

  if (!flags.json && !flags.scoresOnly) {
    await maybeRenderStaleAlert(scores.source, scores.updated_at);
  }

  const data: ProfileData = {
    scores,
    summary,
    insights: insightData?.insights ?? [],
    session,
  };

  console.log(renderProfile(data, flags));
}
