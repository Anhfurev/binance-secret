// @ts-nocheck
/**
 * 24h-ish "vibe" context: free Fear & Greed (Alternative.me) + optional CryptoPanic hack headlines.
 * Used to haircut BUY conviction when the tape disagrees with social fear / major incident news.
 */

const FETCH_TIMEOUT_MS = 2800;
const FEAR_GREED_EXTREME_MAX = 24;
const HACK_KEYWORD_RE =
  /\b(hack|hacked|breach|exploit|drained|stolen|rug\s*pull|sec\s+charges|indictment|bankruptcy|insolvent|bridge\s+exploit|flash\s+loan)\b/i;

export type SentimentVibeMeta = {
  fear_greed_value: number | null;
  fear_greed_label: string | null;
  hack_major_alert: boolean;
  hack_sample_title?: string | null;
  sources: string[];
  fetch_errors?: string[];
};

function coinFromSymbol(symbol: string): string {
  const s = String(symbol ?? "").toUpperCase().replace(/USDT$/i, "");
  return s.length ? s.slice(0, 12) : "BTC";
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Latest Crypto Fear & Greed (0–100, low = fear). No API key. */
export async function fetchFearGreed24h(): Promise<{
  value: number | null;
  label: string | null;
}> {
  const raw = await fetchJsonWithTimeout(
    "https://api.alternative.me/fng/?limit=1",
  );
  const row = (raw as any)?.data?.[0];
  if (!row) return { value: null, label: null };
  const value = Number(row.value);
  const label = typeof row.value_classification === "string"
    ? row.value_classification
    : null;
  return {
    value: Number.isFinite(value) ? value : null,
    label,
  };
}

function isPublishedWithinHours(iso: string, hours: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= hours * 3600 * 1000;
}

/**
 * Optional: set CRYPTOPANIC_API_TOKEN (developer token) for headline scan.
 * https://cryptopanic.com/developers/api/
 */
export async function fetchCryptoPanicHackAlert(
  symbol: string,
): Promise<{ alert: boolean; sampleTitle: string | null }> {
  const token = Deno.env.get("CRYPTOPANIC_API_TOKEN")?.trim();
  if (!token) return { alert: false, sampleTitle: null };
  const coin = coinFromSymbol(symbol);
  const url =
    `https://cryptopanic.com/api/v1/posts/?auth=${encodeURIComponent(token)}&currencies=${encodeURIComponent(coin)}&kind=news&public=true`;
  const raw = await fetchJsonWithTimeout(url);
  const results = Array.isArray((raw as any)?.results) ? (raw as any).results : [];
  const errors = (raw as any)?.info?.error;
  if (errors) return { alert: false, sampleTitle: null };

  for (const r of results) {
    const title = String(r?.title ?? "");
    const published = String(r?.published_at ?? r?.created_at ?? "");
    if (!title || !HACK_KEYWORD_RE.test(title)) continue;
    if (!isPublishedWithinHours(published, 36)) continue;
    return { alert: true, sampleTitle: title.slice(0, 200) };
  }
  return { alert: false, sampleTitle: null };
}

export function isExtremeFearFng(value: number | null, label: string | null): boolean {
  if (value != null && Number.isFinite(value) && value <= FEAR_GREED_EXTREME_MAX) {
    return true;
  }
  if (label && /extreme\s*fear/i.test(label)) return true;
  return false;
}

export async function collectSentimentVibe(symbol: string): Promise<SentimentVibeMeta> {
  const sources: string[] = [];
  const fetch_errors: string[] = [];

  const [fgSettled, cpSettled] = await Promise.allSettled([
    fetchFearGreed24h(),
    fetchCryptoPanicHackAlert(symbol),
  ]);

  let fear_greed_value: number | null = null;
  let fear_greed_label: string | null = null;
  if (fgSettled.status === "fulfilled") {
    fear_greed_value = fgSettled.value.value;
    fear_greed_label = fgSettled.value.label;
    sources.push("alternative.me_fng");
  } else {
    fetch_errors.push(String(fgSettled.reason ?? "fng_failed"));
  }

  let hack_major_alert = false;
  let hack_sample_title: string | null = null;
  if (cpSettled.status === "fulfilled") {
    hack_major_alert = cpSettled.value.alert;
    hack_sample_title = cpSettled.value.sampleTitle;
    if (Deno.env.get("CRYPTOPANIC_API_TOKEN")?.trim()) {
      sources.push("cryptopanic");
    }
  } else {
    fetch_errors.push(String(cpSettled.reason ?? "cryptopanic_failed"));
  }

  return {
    fear_greed_value,
    fear_greed_label,
    hack_major_alert,
    hack_sample_title,
    sources,
    fetch_errors: fetch_errors.length ? fetch_errors : undefined,
  };
}
