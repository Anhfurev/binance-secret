export function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function optionalEnv(name, fallback = "") {
  const value = String(process.env[name] ?? "").trim();
  return value || fallback;
}

export function readTelegramChatId() {
  return (
    optionalEnv("TELEGRAM_CHAT_ID") ||
    optionalEnv("TELEGRAM_BOT_CHAT_ID")
  );
}

export function readDailyLossLimitUsd() {
  const raw = optionalEnv("DAILY_SALARY_LOSS_LIMIT_USD", "75");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 75;
}

export function readAuditLookbackHours() {
  const raw = optionalEnv("DAILY_SALARY_LOOKBACK_HOURS", "24");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(168, n);
}
