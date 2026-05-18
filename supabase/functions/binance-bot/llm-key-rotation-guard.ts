// @ts-nocheck
import {
  formatLocalCooldownUntilIso,
  isLlmKeyLocallyCooling,
  logKeyRotationSkip,
} from "./llm-local-cooldown-registry.ts";
import {
  getEffectiveLlmKeyErrorCount,
  isLlmErrorCountExhausted,
} from "./llm-key-error-count.ts";
import {
  shouldSkipLlmDbSlotTripleGuard,
  tripleGuardSkipReason,
  type LlmDbKeySlotMeta,
} from "./llm-key-slot-gate.ts";

export type LlmKeyRotationGateOpts = {
  preferredKeyId: string;
  dbRowId?: string | null;
  rowErrorCount?: number;
  slotMeta?: LlmDbKeySlotMeta;
  providerLabel: string;
};

/** Pre-checkout gate: triple-guard + error ceiling + local cooldown (pool handles busy/evict). */
export function shouldSkipLlmKeyForRotation(opts: LlmKeyRotationGateOpts): boolean {
  const meta: LlmDbKeySlotMeta = opts.slotMeta ?? {
    dbRowId: opts.dbRowId ?? undefined,
    errorCount: opts.rowErrorCount,
  };
  if (shouldSkipLlmDbSlotTripleGuard(meta)) {
    console.warn(
      `[KEY ROTATION] ${opts.providerLabel} id=${meta.dbRowId ?? "—"} triple-guard (${tripleGuardSkipReason(meta)}) — skip HTTP`,
    );
    return true;
  }
  const dbId = String(opts.dbRowId ?? meta.dbRowId ?? "").trim();
  if (dbId) {
    const effective = getEffectiveLlmKeyErrorCount(dbId, opts.rowErrorCount ?? meta.errorCount ?? 0);
    if (isLlmErrorCountExhausted(effective)) {
      console.warn(
        `[KEY ROTATION] ${opts.providerLabel} id=${dbId} error_count=${effective} at cap — skip HTTP`,
      );
      return true;
    }
  }
  if (isLlmKeyLocallyCooling(dbId || undefined, opts.preferredKeyId)) {
    const until = formatLocalCooldownUntilIso(dbId || undefined, opts.preferredKeyId);
    if (dbId && until) {
      logKeyRotationSkip(dbId, until, opts.providerLabel);
    } else {
      console.warn(
        `[KEY ROTATION] ${opts.providerLabel} key=${opts.preferredKeyId} in local cooldown until ${until ?? "unknown"}. Rotating...`,
      );
    }
    return true;
  }
  return false;
}
