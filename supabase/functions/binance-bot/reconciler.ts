// @ts-nocheck
/**
 * Standalone reconciliation job: DB open trades vs Binance exposure.
 *
 * Invoke from a separate Edge route or Supabase cron (e.g. weekly), not the
 * hot 60s trading cron. Requires the same secrets as live trading + service
 * role Supabase client.
 *
 * Assumptions (draft):
 * - Single Binance API wallet backs all `trades` rows checked here.
 * - Spot defaultType; `fetchPositions` is often empty on spot — we fall back
 *   to `fetchBalance()` base totals for the symbols present in open trades.
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getSharedBinanceSignedExchange, toCcxtSymbol } from "./exchange-client.ts";
import { sendHighPriorityRedAlert } from "./notifier.ts";
import { toNumber, toStringValue } from "./utils.ts";

const STALE_OPEN_MS = 5 * 60 * 1000;
const DUST_BASE = 1e-8;

function baseAssetFromSymbol(symbol: string): string {
  const s = String(symbol ?? "").toUpperCase();
  if (s.endsWith("USDT")) return s.slice(0, -4);
  const [a] = toCcxtSymbol(s).split("/");
  return a ?? s;
}

function isEffectivelyFlat(exchangeBaseTotal: number, dbAmount: number): boolean {
  if (!Number.isFinite(exchangeBaseTotal) || exchangeBaseTotal < 0) return true;
  if (!Number.isFinite(dbAmount) || dbAmount <= 0) return exchangeBaseTotal <= DUST_BASE;
  const threshold = Math.max(DUST_BASE, dbAmount * 1e-4);
  return exchangeBaseTotal < threshold;
}

async function readSpotBaseTotal(
  exchange: any,
  symbol: string,
): Promise<number> {
  const base = baseAssetFromSymbol(symbol);
  const bal = await exchange.fetchBalance();
  const total = Number(bal?.[base]?.total ?? bal?.total?.[base] ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** Optional: merge CCXT `fetchPositions` when the venue populates them. */
async function readPositionBaseMap(exchange: any): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const positions = await exchange.fetchPositions();
    for (const p of positions ?? []) {
      const sym = String(p?.symbol ?? "");
      if (!sym) continue;
      const contracts = Number(p?.contracts ?? p?.contractSize ?? p?.amount ?? 0);
      if (!Number.isFinite(contracts) || Math.abs(contracts) <= DUST_BASE) continue;
      map.set(sym, (map.get(sym) ?? 0) + Math.abs(contracts));
    }
  } catch {
    // Spot accounts often throw or return empty — balance path below is authoritative.
  }
  return map;
}

export type ReconciliationResult = {
  jobId: string;
  examined: number;
  reconciledClosed: number;
  orphanAlerts: number;
  errors: string[];
};

/**
 * Compare Supabase open trades to Binance exposure; close zombie DB rows and
 * alert on unknown exchange inventory.
 */
export async function runReconciliationJob(params: {
  supabase: ReturnType<typeof createClient>;
}): Promise<ReconciliationResult> {
  const jobId = crypto.randomUUID();
  const errors: string[] = [];
  let examined = 0;
  let reconciledClosed = 0;
  let orphanAlerts = 0;

  const { data: openRows, error: openErr } = await params.supabase
    .from("trades")
    .select("id, user_id, symbol, amount, value, status, opened_at, extra")
    .ilike("status", "open");

  if (openErr) {
    errors.push(`open trades query: ${openErr.message}`);
    return { jobId, examined: 0, reconciledClosed: 0, orphanAlerts: 0, errors };
  }

  const rows = Array.isArray(openRows) ? openRows : [];
  if (rows.length === 0) {
    return { jobId, examined: 0, reconciledClosed: 0, orphanAlerts: 0, errors };
  }

  let exchange: any;
  try {
    exchange = getSharedBinanceSignedExchange();
    await exchange.loadMarkets();
  } catch (e) {
    errors.push(`exchange init: ${e instanceof Error ? e.message : String(e)}`);
    return { jobId, examined: 0, reconciledClosed: 0, orphanAlerts: 0, errors };
  }

  const positionMap = await readPositionBaseMap(exchange);
  const now = Date.now();

  for (const row of rows) {
    examined += 1;
    const id = toStringValue(row.id);
    const symbol = String(row.symbol ?? "").toUpperCase();
    const dbAmount = toNumber(row.amount, 0);
    const openedAt = row.opened_at ? Date.parse(String(row.opened_at)) : NaN;
    const ageMs = Number.isFinite(openedAt) ? now - openedAt : 0;

    try {
      const ccxtSym = toCcxtSymbol(symbol);
      let exchangeBase = positionMap.get(ccxtSym) ?? 0;
      if (exchangeBase <= DUST_BASE) {
        exchangeBase = await readSpotBaseTotal(exchange, symbol);
      }

      if (isEffectivelyFlat(exchangeBase, dbAmount) && ageMs > STALE_OPEN_MS) {
        const extra = {
          ...((row.extra as Record<string, unknown> | undefined) ?? {}),
          reconciled_at: new Date().toISOString(),
          reconciliation_job_id: jobId,
          reconciliation_reason: "db_open_exchange_flat_gt_5m",
          exchange_base_observed: exchangeBase,
        };
        const { data: upd, error: upErr } = await params.supabase
          .from("trades")
          .update({
            status: "RECONCILED_CLOSED",
            closed_at: new Date().toISOString(),
            extra,
            notes: `Reconciler: marked RECONCILED_CLOSED (flat on exchange >5m after opened_at) job=${jobId}`,
          })
          .eq("id", id ?? "")
          .ilike("status", "open")
          .select("id");
        if (upErr) {
          errors.push(`${id}: ${upErr.message}`);
          continue;
        }
        const n = Array.isArray(upd) ? upd.length : 0;
        if (n === 1) reconciledClosed += 1;
      }
    } catch (e) {
      errors.push(`${id ?? row?.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Orphan path: autopilot symbols with on-exchange base but no OPEN trade row (reduces HODL noise).
  try {
    const { data: botRows } = await params.supabase
      .from("bot_settings")
      .select("symbol")
      .eq("is_autopilot_enabled", true);
    const watchSyms = new Set(
      (Array.isArray(botRows) ? botRows : [])
        .map((r: { symbol?: string }) => String(r.symbol ?? "").toUpperCase())
        .filter(Boolean),
    );

    if (watchSyms.size > 0) {
      const bal = await exchange.fetchBalance();
      const openSymbols = new Set(rows.map((r: any) => String(r.symbol ?? "").toUpperCase()));
      const totals = (bal?.total ?? {}) as Record<string, number>;
      for (const sym of watchSyms) {
        const base = baseAssetFromSymbol(sym);
        const total = Number(totals[base] ?? 0);
        if (!Number.isFinite(total) || total <= DUST_BASE) continue;
        if (!exchange.markets?.[toCcxtSymbol(sym)]) continue;
        if (openSymbols.has(sym)) continue;
        orphanAlerts += 1;
        await sendHighPriorityRedAlert(
          `<b>Orphan exchange inventory (watched symbol)</b>\n` +
            `<b>Symbol:</b> <code>${sym}</code>\n` +
            `<b>Base balance:</b> <code>${total}</code>\n` +
            `<b>Detail:</b> Autopilot watches this market but there is no OPEN <code>trades</code> row — verify fills, partials, or manual orders.`,
          jobId,
        );
      }
    }
  } catch (e) {
    errors.push(`orphan scan: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { jobId, examined, reconciledClosed, orphanAlerts, errors };
}
