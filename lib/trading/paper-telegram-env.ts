let telegramEnvWarned = false;

export function isPaperTelegramConfigured(): boolean {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID ?? "").trim();
  return Boolean(token && chatId);
}

/** Log once per process when Telegram env is missing (common after accidental .env.local overwrite). */
export function warnPaperTelegramEnvOnce(): void {
  if (telegramEnvWarned || isPaperTelegramConfigured()) return;
  telegramEnvWarned = true;
  console.warn(
    "[paper-telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — manifest will not reach Telegram. Restore both in ~/binance-bot/.env.local then: pm2 restart binance-app --update-env",
  );
}
