import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

let validated = false;
let validationPromise: Promise<boolean> | null = null;

/** Single canonical profiles.id for all paper engine DB writes. */
export function getPaperDbUserId(): string | null {
  const id = String(process.env.PAPER_TRADES_USER_ID ?? "").trim();
  return id.length > 0 ? id : null;
}

/**
 * Prefer PAPER_TRADES_USER_ID; only fall back to ownerId when env unset (local dev).
 */
export function resolvePaperTradesUserId(
  ownerType: "device" | "user",
  ownerId: string,
): string | null {
  const mapped = getPaperDbUserId();
  if (mapped) return mapped;
  if (ownerType === "user" && ownerId.trim().length > 0) return ownerId.trim();
  return null;
}

async function validatePaperDbUserOnce(): Promise<boolean> {
  if (validated) return true;

  const userId = getPaperDbUserId();
  if (!userId) {
    console.warn(
      "[paper-db] PAPER_TRADES_USER_ID unset — paper_positions/profiles sync disabled",
    );
    return false;
  }

  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    console.warn("[paper-db] Supabase admin not configured");
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,available_usdt,portfolio_nav_usdt,demo_balance")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.id) {
    console.warn("[paper-db] PAPER_TRADES_USER_ID not found in public.profiles", {
      userId: `${userId.slice(0, 8)}…`,
      message: error?.message ?? "no row",
    });
    return false;
  }

  validated = true;
  console.log("[paper-db] paper wallet linked", {
    profileId: `${userId.slice(0, 8)}…`,
    available_usdt: data.available_usdt,
    portfolio_nav_usdt: data.portfolio_nav_usdt,
  });
  return true;
}

/** Call before paper_positions insert — caches result for process lifetime. */
export async function ensurePaperDbUserReady(): Promise<boolean> {
  if (validated) return true;
  if (!validationPromise) {
    validationPromise = validatePaperDbUserOnce();
  }
  return validationPromise;
}

void ensurePaperDbUserReady();
