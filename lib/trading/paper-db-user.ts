import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

let validated = false;

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
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[paper-db] profiles lookup failed", {
      userId: `${userId.slice(0, 8)}…`,
      message: error.message,
    });
    return false;
  }

  if (!data?.id) {
    console.warn("[paper-db] PAPER_TRADES_USER_ID not found in public.profiles", {
      userId: `${userId.slice(0, 8)}…`,
      hint: "Use a real profiles.id from Supabase",
    });
    return false;
  }

  validated = true;
  console.log("[paper-db] paper wallet linked", {
    profileId: `${userId.slice(0, 8)}…`,
  });
  return true;
}

/** Runtime-only validation — never call at module import (breaks next build). */
export async function ensurePaperDbUserReady(): Promise<boolean> {
  if (validated) return true;
  return validatePaperDbUserOnce();
}
