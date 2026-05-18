import {
  candleGainPct,
  computeRsi14,
  computeRvol24h,
  parseKlineRow,
  type CandleSeed,
} from "./kline-math";
import { firePaperRunTrigger, shouldThrottleSymbol } from "./trigger-engine";

const PRICE_SPIKE_PCT = 1.2;
const RVOL_MIN = 2;
const RSI_MIN = 60;

type SymbolState = {
  closedVolumes: number[];
  closedCloses: number[];
  lastClosedOpenTime: number;
};

const stateBySymbol = new Map<string, SymbolState>();

function getState(symbol: string): SymbolState {
  const key = symbol.toUpperCase();
  let row = stateBySymbol.get(key);
  if (!row) {
    row = { closedVolumes: [], closedCloses: [], lastClosedOpenTime: 0 };
    stateBySymbol.set(key, row);
  }
  return row;
}

export function seedSymbolHistory(
  symbol: string,
  candles: CandleSeed[],
): void {
  const st = getState(symbol);
  st.closedVolumes = candles.map((c) => c.volume);
  st.closedCloses = candles.map((c) => c.close);
}

export async function handleKlineEvent(
  symbol: string,
  k: Record<string, unknown>,
): Promise<void> {
  const candle = parseKlineRow(k);
  if (!candle) return;

  const sym = symbol.toUpperCase();
  const st = getState(sym);
  const isClosed = Boolean(k.x);
  const openTime = Number(k.t) || 0;

  if (isClosed && openTime > st.lastClosedOpenTime) {
    st.lastClosedOpenTime = openTime;
    st.closedVolumes.push(candle.volume);
    st.closedCloses.push(candle.close);
    if (st.closedVolumes.length > 120) {
      st.closedVolumes = st.closedVolumes.slice(-120);
      st.closedCloses = st.closedCloses.slice(-120);
    }
  }

  const volumes = [...st.closedVolumes, candle.volume];
  const closes = [...st.closedCloses, candle.close];
  const rvol = computeRvol24h(volumes);
  const rsi = computeRsi14(closes);
  const gainPct = candleGainPct(candle);

  const priceSpike = gainPct >= PRICE_SPIKE_PCT;
  const volumeSurge = rvol > RVOL_MIN && rsi > RSI_MIN;

  if (!priceSpike && !volumeSurge) return;
  if (shouldThrottleSymbol(sym)) return;

  const reason = priceSpike
    ? `price-spike-${gainPct.toFixed(2)}%`
    : `rvol-${rvol}-rsi-${rsi}`;
  console.log(`[ws-daemon] velocity ${sym} → ${reason}`);
  await firePaperRunTrigger(`${sym}:${reason}`);
}
