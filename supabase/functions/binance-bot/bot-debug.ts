// @ts-nocheck
type DebugMeta = Record<string, unknown>;

/** `botDebug` emits Sentry breadcrumbs for these events when `SENTRY_DSN` is set. */
const SENTRY_DEBUG_EVENTS = new Set([
  "war_room_gate_passed",
  "pre_create_order",
  "pre_create_sell_order",
  // Silent-skip catchers (DEBUG_LOG_ENHANCEMENT plan):
  //   1) War Room quorum failure where we may have taken the trade pre-cap.
  //   2) reserve_buy_capital null returns once ghost is excluded — phantom blocks.
  //   3) Vol burst guard short-circuited by dirty kline / volume data.
  "war_room_quorum_failed",
  "capital_reservation_phantom_block",
  "vol_burst_guard_dirty_data",
]);

let sentryLoadPromise: Promise<typeof import("@sentry/deno") | null> | null = null;

function getSentryDsn(): string | null {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (typeof dsn !== "string") return null;
  const t = dsn.trim();
  return t.length > 0 ? t : null;
}

/** Lazy-init Sentry once per isolate when DSN is configured. */
function loadSentry(): Promise<typeof import("@sentry/deno") | null> {
  const dsn = getSentryDsn();
  if (!dsn) return Promise.resolve(null);
  if (!sentryLoadPromise) {
    sentryLoadPromise = import("@sentry/deno")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          tracesSampleRate: 0,
        });
        return Sentry;
      })
      .catch((e) => {
        console.warn(`[BOT DEBUG] sentry_init_failed ${String(e)}`);
        return null;
      });
  }
  return sentryLoadPromise;
}

async function addSentryBreadcrumb(scope: string, event: string, meta: DebugMeta) {
  try {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    Sentry.addBreadcrumb({
      category: `bot.${scope}`,
      message: event,
      level: "info",
      data: meta,
    });
  } catch (e) {
    console.warn(`[BOT DEBUG] sentry_breadcrumb_failed ${scope}.${event} ${String(e)}`);
  }
}

/** War Room signals: breadcrumbs alone do not show in Sentry Issues; send a message + flush for serverless. */
async function emitWarRoomSentryEvent(scope: string, event: string, meta: DebugMeta) {
  try {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    Sentry.addBreadcrumb({
      category: `bot.${scope}`,
      message: event,
      level: "info",
      data: meta,
    });
    Sentry.withScope((scope_) => {
      scope_.setTag("binance_bot", "war_room");
      scope_.setTag("event", event);
      scope_.setContext("war_room", meta);
      Sentry.captureMessage(`[binance-bot] ${scope}.${event}`, "info");
    });
    await Sentry.flush(2000);
  } catch (e) {
    console.warn(`[BOT DEBUG] sentry_war_room_emit_failed ${scope}.${event} ${String(e)}`);
  }
}

function safeJson(meta: DebugMeta) {
  try {
    return JSON.stringify(meta);
  } catch {
    return JSON.stringify({ error: "meta_serialize_failed" });
  }
}

const WAR_ROOM_SENTRY_EVENTS = new Set([
  "war_room_gate_passed",
  "war_room_quorum_failed",
]);

export function botDebug(scope: string, event: string, meta: DebugMeta = {}) {
  console.log(`[BOT DEBUG] ${scope}.${event} ${safeJson(meta)}`);
  if (SENTRY_DEBUG_EVENTS.has(event)) {
    if (WAR_ROOM_SENTRY_EVENTS.has(event)) {
      void emitWarRoomSentryEvent(scope, event, meta);
    } else {
      void addSentryBreadcrumb(scope, event, meta);
    }
  }
}

export function botWarn(scope: string, event: string, meta: DebugMeta = {}) {
  console.warn(`[BOT WARN] ${scope}.${event} ${safeJson(meta)}`);
}

export function botError(scope: string, event: string, meta: DebugMeta = {}) {
  console.error(`[BOT ERROR] ${scope}.${event} ${safeJson(meta)}`);
}

/** Top-level fatal boundary: capture in Sentry (when DSN set) for serverless post-mortems. */
export async function emitSentryFatalException(
  error: unknown,
  meta: DebugMeta = {},
) {
  try {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : String(error));
    Sentry.withScope((s) => {
      s.setTag("binance_bot", "fatal");
      s.setContext("fatal", { ...meta, ts: new Date().toISOString() });
      Sentry.captureException(err);
    });
    await Sentry.flush(2000);
  } catch (e) {
    console.warn(`[BOT DEBUG] sentry_fatal_capture_failed ${String(e)}`);
  }
}

let bootProbeFired = false;

/**
 * One-shot boot probe: emits a Sentry message per cold start when
 * `SENTRY_DSN` is set AND `SENTRY_DEBUG_BOOT=1`. Use it ONCE to confirm the
 * Edge → Sentry pipeline is live, then unset the flag to stop noise.
 */
export async function emitSentryBootProbe(meta: DebugMeta = {}) {
  if (bootProbeFired) return;
  if (Deno.env.get("SENTRY_DEBUG_BOOT") !== "1") return;
  bootProbeFired = true;
  try {
    const Sentry = await loadSentry();
    if (!Sentry) {
      console.warn(`[BOT DEBUG] sentry_boot_probe_skipped no_dsn_or_init_failed`);
      return;
    }
    Sentry.withScope((s) => {
      s.setTag("binance_bot", "boot_probe");
      s.setContext("boot", { ...meta, ts: new Date().toISOString() });
      Sentry.captureMessage("[binance-bot] boot_probe", "info");
    });
    await Sentry.flush(2000);
    console.log(`[BOT DEBUG] sentry_boot_probe_sent ${safeJson(meta)}`);
  } catch (e) {
    console.warn(`[BOT DEBUG] sentry_boot_probe_failed ${String(e)}`);
  }
}

/**
 * War Room news veto: `final_governance === "veto_blocked"` (Sentry only when DSN set).
 * Breadcrumb carries `news_vibe` (AI sentiment) and `technician_score` for post-mortems.
 */
export function sentryWarRoomVetoBreadcrumb(params: {
  final_governance: string;
  news_vibe: unknown;
  technician_score: number;
  userId?: string;
  symbol?: string;
}) {
  if (params.final_governance !== "veto_blocked") return;
  void emitWarRoomSentryEvent("buyFlow", "war_room_veto_blocked", {
    news_vibe: params.news_vibe,
    technician_score: params.technician_score,
    userId: params.userId,
    symbol: params.symbol,
  });
}
