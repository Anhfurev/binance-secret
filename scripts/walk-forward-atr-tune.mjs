#!/usr/bin/env node
/**
 * Walk-forward ATR trail multiplier tuning (Sunday-night style job).
 *
 * - Pulls ~7d of 5m OHLCV from Binance public API for one symbol.
 * - Runs a lightweight long-only toy strategy (SMA20 cross entries, ATR-based
 *   chandelier trail exit) for each candidate multiplier.
 * - Scores by total return % / (max drawdown % + epsilon) — profit vs pain.
 * - Writes `scripts/walk-forward-atr-last.json` and patches
 *   `supabase/functions/binance-bot/constants.ts` unless DRY_RUN=1.
 *
 * Cron (example): `0 2 * * 0 cd /path/to/repo && node scripts/walk-forward-atr-tune.mjs >> /tmp/wf-atr.log 2>&1`
 *
 * Env:
 *   WALK_FORWARD_SYMBOL   default BTCUSDT
 *   WALK_FORWARD_DAYS     default 7
 *   DRY_RUN=1             print winner only, do not write constants.ts
 *   WALK_FORWARD_MIN_SCORE  default 0 — do not patch if best score is below (toy sim all weak)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CONSTANTS_FILE = path.join(
  REPO_ROOT,
  "supabase/functions/binance-bot/constants.ts",
);
const REPORT_FILE = path.join(__dirname, "walk-forward-atr-last.json");

const BINANCE = "https://api.binance.com";
const SYMBOL = (process.env.WALK_FORWARD_SYMBOL || "BTCUSDT").toUpperCase();
const DAYS = Math.min(30, Math.max(3, Number(process.env.WALK_FORWARD_DAYS) || 7));
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
/** Skip writing constants.ts when best score is below this (all variants weak on the toy sim). */
const MIN_SCORE_TO_APPLY = Number(process.env.WALK_FORWARD_MIN_SCORE ?? "0");

/** Five variants around production default 1.5 */
const MULT_CANDIDATES = [1.2, 1.35, 1.5, 1.65, 1.8];
const ATR_PERIOD = 14;
const SMA_LEN = 20;

async function fetchKlinesChunk(symbol, interval, startMs, endMs) {
  const url = new URL(`${BINANCE}/api/v3/klines`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("endTime", String(endMs));
  url.searchParams.set("limit", "1000");
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Binance klines ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchKlinesRange(symbol, interval, startMs, endMs) {
  const all = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const chunk = await fetchKlinesChunk(symbol, interval, cursor, endMs);
    if (!chunk.length) break;
    for (const k of chunk) {
      all.push({
        openTime: k[0],
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
      });
    }
    const lastOpen = chunk[chunk.length - 1][0];
    const step = chunk.length * intervalMs(interval);
    cursor = lastOpen + step;
    if (chunk.length < 1000) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return all;
}

function intervalMs(iv) {
  if (iv === "5m") return 5 * 60 * 1000;
  if (iv === "1m") return 60 * 1000;
  if (iv === "15m") return 15 * 60 * 1000;
  if (iv === "1h") return 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

function buildAtrArray(candles, period) {
  const n = candles.length;
  const atr = new Array(n).fill(0);
  const trs = [];
  let prevClose = candles[0].close;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    prevClose = c.close;
    trs.push(tr);
    const k = trs.length - 1;
    if (k < period - 1) continue;
    if (k === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += trs[j];
      atr[i] = s / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

function buildSmaArray(closes, len) {
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= len) sum -= closes[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function simulate(mult, candles, atr, sma) {
  let inPos = false;
  let entry = 0;
  let highest = 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let trades = 0;

  for (let i = Math.max(ATR_PERIOD + 2, SMA_LEN + 2); i < candles.length; i++) {
    const c = candles[i];
    const low = c.low;
    const close = c.close;
    const a = atr[i];
    const s = sma[i];
    const sp = sma[i - 1];
    const cp = candles[i - 1].close;

    if (!inPos) {
      if (Number.isFinite(s) && Number.isFinite(sp) && cp <= sp && close > s && a > 0) {
        inPos = true;
        entry = close;
        highest = Math.max(c.high, close);
        trades++;
      }
      continue;
    }

    highest = Math.max(highest, c.high);
    const trail = highest - mult * a;
    if (low < trail) {
      const exitPx = Math.max(trail, low);
      const ret = (exitPx - entry) / entry;
      equity *= 1 + ret;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, (peak - equity) / peak);
      inPos = false;
    }
  }

  const totalReturnPct = (equity - 1) * 100;
  const maxDdPct = maxDd * 100;
  const score = totalReturnPct / (maxDdPct + 0.05);
  return { totalReturnPct, maxDdPct, score, trades, equity };
}

function patchConstantsFile(newMult) {
  const raw = fs.readFileSync(CONSTANTS_FILE, "utf8");
  const re = /export const ATR_STOP_TRAIL_MULTIPLIER = [\d.]+;/;
  if (!re.test(raw)) {
    throw new Error("Could not find ATR_STOP_TRAIL_MULTIPLIER line in constants.ts");
  }
  const stamp = new Date().toISOString();
  const next =
    `export const ATR_STOP_TRAIL_MULTIPLIER = ${newMult}; // walk-forward tuned ${stamp}`;
  const out = raw.replace(re, next);
  fs.writeFileSync(CONSTANTS_FILE, out, "utf8");
}

async function main() {
  const endMs = Date.now();
  const startMs = endMs - DAYS * 24 * 60 * 60 * 1000;
  console.log(
    `[walk-forward-atr] symbol=${SYMBOL} days=${DAYS} mults=${MULT_CANDIDATES.join(",")} dryRun=${DRY_RUN}`,
  );

  const candles = await fetchKlinesRange(SYMBOL, "5m", startMs, endMs);
  if (candles.length < 200) {
    throw new Error(`Too few candles: ${candles.length}`);
  }

  const closes = candles.map((c) => c.close);
  const atr = buildAtrArray(candles, ATR_PERIOD);
  const sma = buildSmaArray(closes, SMA_LEN);

  const results = MULT_CANDIDATES.map((mult) => ({
    mult,
    ...simulate(mult, candles, atr, sma),
  }));

  results.sort((a, b) => b.score - a.score);
  const winner = results[0];

  const report = {
    ranAt: new Date().toISOString(),
    symbol: SYMBOL,
    days: DAYS,
    bars: candles.length,
    candidates: results,
    winner: { mult: winner.mult, score: winner.score, totalReturnPct: winner.totalReturnPct, maxDdPct: winner.maxDdPct, trades: winner.trades },
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[walk-forward-atr] winner mult=${winner.mult} score=${winner.score.toFixed(4)} ret=${winner.totalReturnPct.toFixed(3)}% maxDD=${winner.maxDdPct.toFixed(3)}% trades=${winner.trades} -> report ${REPORT_FILE}`,
  );

  if (DRY_RUN) {
    console.log("[walk-forward-atr] DRY_RUN: skipping constants.ts patch");
    return;
  }

  if (!Number.isFinite(winner.score) || winner.score < MIN_SCORE_TO_APPLY) {
    console.log(
      `[walk-forward-atr] best score ${winner.score} < MIN_SCORE_TO_APPLY (${MIN_SCORE_TO_APPLY}) — not patching constants.ts`,
    );
    return;
  }

  patchConstantsFile(winner.mult);
  console.log(`[walk-forward-atr] updated ${CONSTANTS_FILE} -> ATR_STOP_TRAIL_MULTIPLIER = ${winner.mult}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
