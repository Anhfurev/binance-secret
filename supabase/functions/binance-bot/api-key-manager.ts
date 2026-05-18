// @ts-nocheck
/**
 * Async-safe API key pool for parallel symbol lanes (Promise.all / concurrent cron).
 *
 * @example
 * const keys = new APIKeyManager();
 * keys.registerKeys(geminiSlots.map((s, i) => ({
 *   id: `gemini:${i}`,
 *   provider: "gemini",
 *   secret: s.value,
 *   dbRowId: s.llmDbKeyId,
 * })));
 *
 * const { keyId, secret } = await keys.checkoutKey("gemini", { timeoutMs: 15_000 });
 * try {
 *   return await fetchAICall(secret, payload);
 * } catch (err) {
 *   keys.recordExecutionError(keyId, err);
 *   throw err;
 * } finally {
 *   keys.checkinKey(keyId);
 * }
 */

import {
  isLlmBlockedHttpFailure,
  isLlmClientPayloadHttpFailure,
  isLlmRateLimitHttpFailure,
} from "./llm-key-failure-classify.ts";

export type LlmProvider = "gemini" | "groq";

export type ManagedKeyStatus = "available" | "in_use" | "cooldown" | "disabled";

export type ManagedApiKey = {
  id: string;
  provider: LlmProvider;
  secret: string;
  dbRowId?: string;
};

export type CheckoutOptions = {
  /** Max wait when every eligible key is checked out. Default 30_000. */
  timeoutMs?: number;
  /** Try this key first (still skipped if cooling/disabled/busy). */
  preferredKeyId?: string;
};

export type CheckoutHandle = {
  keyId: string;
  secret: string;
  dbRowId?: string;
};

export type KeyPoolStats = {
  total: number;
  available: number;
  inUse: number;
  cooldown: number;
  disabled: number;
  waiting: number;
};

type KeyRecord = ManagedApiKey & {
  status: ManagedKeyStatus;
  cooldownUntilMs: number;
  lastError?: string;
};

type Waiter = {
  opts: CheckoutOptions;
  resolve: (handle: CheckoutHandle) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class APIKeyCheckoutTimeoutError extends Error {
  constructor(
    readonly provider: LlmProvider,
    readonly timeoutMs: number,
  ) {
    super(`[APIKeyManager] checkout timeout provider=${provider} after ${timeoutMs}ms`);
    this.name = "APIKeyCheckoutTimeoutError";
  }
}

export class APIKeyNotFoundError extends Error {
  constructor(readonly keyId: string) {
    super(`[APIKeyManager] unknown key id=${keyId}`);
    this.name = "APIKeyNotFoundError";
  }
}

function normalizeSecret(secret: string): string {
  return String(secret ?? "").trim();
}

function secretFingerprint(provider: LlmProvider, secret: string): string {
  const v = normalizeSecret(secret);
  return v ? `${provider}:${v}` : "";
}

/** Promise-chain gate — serializes checkout/checkin mutations (async-safe in JS). */
function createAsyncGate() {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export class APIKeyManager {
  private readonly keys = new Map<string, KeyRecord>();
  private readonly orderByProvider = new Map<LlmProvider, string[]>();
  private readonly inUseKeyIds = new Set<string>();
  private readonly inUseSecrets = new Set<string>();
  private readonly waiters = new Map<LlmProvider, Waiter[]>();
  private readonly gate = createAsyncGate();
  private laneRoundRobin = 0;

  registeredKeyCount(): number {
    return this.keys.size;
  }

  /** Keys that can be checked out right now (not disabled / past cooldown). */
  countEligibleKeys(provider?: LlmProvider): number {
    const now = Date.now();
    let n = 0;
    for (const rec of this.keys.values()) {
      if (provider && rec.provider !== provider) continue;
      if (this.isEligible(rec, now)) n += 1;
    }
    return n;
  }

  /** True after `registerKeys` populated at least one checkout-eligible secret. */
  isHydrated(opts?: { requireGemini?: boolean; requireGroq?: boolean }): boolean {
    if (this.keys.size === 0 || this.countEligibleKeys() === 0) return false;
    if (opts?.requireGemini) {
      const ids = this.orderByProvider.get("gemini") ?? [];
      if (!ids.length || this.countEligibleKeys("gemini") === 0) return false;
    }
    if (opts?.requireGroq) {
      const ids = this.orderByProvider.get("groq") ?? [];
      if (!ids.length || this.countEligibleKeys("groq") === 0) return false;
    }
    return true;
  }

  /** Load or replace the pool for a cron cycle. */
  registerKeys(keys: ManagedApiKey[]): void {
    this.keys.clear();
    this.orderByProvider.clear();
    for (const k of keys) {
      const secret = normalizeSecret(k.secret);
      if (!secret) continue;
      this.keys.set(k.id, {
        ...k,
        secret,
        status: "available",
        cooldownUntilMs: 0,
      });
      const list = this.orderByProvider.get(k.provider) ?? [];
      if (!list.includes(k.id)) list.push(k.id);
      this.orderByProvider.set(k.provider, list);
    }
  }

  /** Clear in-use state and waiters (e.g. new cron publish). */
  reset(): void {
    for (const q of this.waiters.values()) {
      for (const w of q) clearTimeout(w.timeoutId);
    }
    this.waiters.clear();
    this.inUseKeyIds.clear();
    this.inUseSecrets.clear();
    this.laneRoundRobin = 0;
    for (const rec of this.keys.values()) {
      if (rec.status === "in_use") rec.status = "available";
    }
  }

  /** Spread parallel lanes across the pool (call once per symbol before checkout). */
  bumpLaneOffset(): number {
    const n = this.laneRoundRobin;
    this.laneRoundRobin += 1;
    return n;
  }

  /**
   * Reserve one eligible key. Waits until another lane checks in or timeout.
   */
  async checkoutKey(
    provider: LlmProvider,
    opts: CheckoutOptions = {},
  ): Promise<CheckoutHandle> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const immediate = await this.gate(() => this.tryCheckoutNow(provider, opts));
    if (immediate) return immediate;
    return new Promise<CheckoutHandle>((resolve, reject) => {
      const waiter: Waiter = {
        opts,
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          this.removeWaiter(provider, waiter);
          reject(new APIKeyCheckoutTimeoutError(provider, timeoutMs));
        }, timeoutMs),
      };
      const q = this.waiters.get(provider) ?? [];
      q.push(waiter);
      this.waiters.set(provider, q);
    });
  }

  /** Return a key to the pool and wake the next waiter. */
  checkinKey(keyId: string): void {
    void this.gate(() => {
      this.releaseKey(keyId);
      const rec = this.keys.get(keyId);
      if (rec) this.drainWaiters(rec.provider);
    });
  }

  markCooldown(keyId: string, minutes: number, reason?: string): void {
    void this.gate(() => {
      const rec = this.keys.get(keyId);
      if (!rec) throw new APIKeyNotFoundError(keyId);
      this.releaseKey(keyId);
      rec.status = "cooldown";
      rec.cooldownUntilMs = Date.now() + Math.max(1, minutes) * 60_000;
      if (reason) rec.lastError = reason;
      this.drainWaiters(rec.provider);
    });
  }

  markDisabled(keyId: string, reason?: string): void {
    void this.gate(() => {
      const rec = this.keys.get(keyId);
      if (!rec) throw new APIKeyNotFoundError(keyId);
      this.releaseKey(keyId);
      rec.status = "disabled";
      rec.cooldownUntilMs = Number.MAX_SAFE_INTEGER;
      if (reason) rec.lastError = reason;
      this.drainWaiters(rec.provider);
    });
  }

  markAvailable(keyId: string): void {
    void this.gate(() => {
      const rec = this.keys.get(keyId);
      if (!rec) throw new APIKeyNotFoundError(keyId);
      rec.status = "available";
      rec.cooldownUntilMs = 0;
      rec.lastError = undefined;
      this.drainWaiters(rec.provider);
    });
  }

  /** Classify HTTP failure and apply cooldown/disabled without checkin (call before checkin). */
  recordExecutionError(
    keyId: string,
    err: unknown,
    opts?: { rateLimitCooldownMinutes?: number; invalidKeyDisable?: boolean },
  ): "rate_limit" | "invalid_key" | "transient" | "client_error" {
    if (isLlmClientPayloadHttpFailure(err)) {
      return "client_error";
    }
    const rateMin = opts?.rateLimitCooldownMinutes ?? 15;
    const disableInvalid = opts?.invalidKeyDisable !== false;
    if (isLlmRateLimitHttpFailure(err)) {
      this.markCooldown(keyId, rateMin, "rate_limit");
      return "rate_limit";
    }
    if (disableInvalid && isLlmBlockedHttpFailure(err)) {
      this.markDisabled(keyId, "invalid_or_suspended");
      return "invalid_key";
    }
    return "transient";
  }

  /** Whether this key can be checked out (not in_use/cooldown/disabled for self). */
  isKeyEligible(keyId: string): boolean {
    const rec = this.keys.get(keyId);
    if (!rec) return false;
    return this.isEligible(rec, Date.now());
  }

  listDbRowIdsByStatus(status: "cooldown" | "disabled"): string[] {
    const out: string[] = [];
    for (const rec of this.keys.values()) {
      if (rec.status !== status) continue;
      const dbId = String(rec.dbRowId ?? "").trim();
      if (dbId) out.push(dbId);
    }
    return out;
  }

  readPoolLogStats(): {
    inFlight: number;
    cooldown: number;
    disabled: number;
  } {
    let inFlight = 0;
    let cooldown = 0;
    let disabled = 0;
    for (const rec of this.keys.values()) {
      if (rec.status === "in_use" || this.inUseKeyIds.has(rec.id)) inFlight += 1;
      else if (rec.status === "disabled") disabled += 1;
      else if (rec.status === "cooldown") cooldown += 1;
    }
    return { inFlight, cooldown, disabled };
  }

  getStats(provider: LlmProvider): KeyPoolStats {
    const ids = this.orderByProvider.get(provider) ?? [];
    let available = 0;
    let inUse = 0;
    let cooldown = 0;
    let disabled = 0;
    const now = Date.now();
    for (const id of ids) {
      const rec = this.keys.get(id);
      if (!rec) continue;
      this.refreshCooldownStatus(rec, now);
      if (rec.status === "in_use" || this.inUseKeyIds.has(id)) inUse += 1;
      else if (rec.status === "disabled") disabled += 1;
      else if (rec.status === "cooldown") cooldown += 1;
      else if (this.isEligible(rec, now)) available += 1;
    }
    return {
      total: ids.length,
      available,
      inUse,
      cooldown,
      disabled,
      waiting: (this.waiters.get(provider) ?? []).length,
    };
  }

  private refreshCooldownStatus(rec: KeyRecord, now: number): void {
    if (rec.status === "cooldown" && rec.cooldownUntilMs <= now) {
      rec.status = "available";
      rec.cooldownUntilMs = 0;
    }
  }

  private isEligible(rec: KeyRecord, now: number): boolean {
    this.refreshCooldownStatus(rec, now);
    if (rec.status === "disabled") return false;
    if (rec.status === "cooldown") return false;
    if (this.inUseKeyIds.has(rec.id)) return false;
    const fp = secretFingerprint(rec.provider, rec.secret);
    if (fp && this.inUseSecrets.has(fp)) return false;
    return true;
  }

  private tryCheckoutNow(
    provider: LlmProvider,
    opts: CheckoutOptions,
  ): CheckoutHandle | null {
    const pick = this.pickKeyId(provider, opts);
    if (!pick) return null;
    return this.reserveKey(pick);
  }

  private pickKeyId(provider: LlmProvider, opts: CheckoutOptions): string | null {
    const order = this.orderByProvider.get(provider) ?? [];
    if (!order.length) return null;
    const now = Date.now();
    const preferred = opts.preferredKeyId;
    const lane = this.laneRoundRobin;
    const rotated: string[] = [];
    if (preferred && order.includes(preferred)) rotated.push(preferred);
    const start = lane % order.length;
    for (let i = 0; i < order.length; i += 1) {
      const id = order[(start + i) % order.length]!;
      if (id === preferred) continue;
      rotated.push(id);
    }
    for (const id of rotated) {
      const rec = this.keys.get(id);
      if (rec && this.isEligible(rec, now)) return id;
    }
    return null;
  }

  private reserveKey(keyId: string): CheckoutHandle {
    const rec = this.keys.get(keyId);
    if (!rec) throw new APIKeyNotFoundError(keyId);
    rec.status = "in_use";
    this.inUseKeyIds.add(keyId);
    const fp = secretFingerprint(rec.provider, rec.secret);
    if (fp) this.inUseSecrets.add(fp);
    return { keyId: rec.id, secret: rec.secret, dbRowId: rec.dbRowId };
  }

  private releaseKey(keyId: string): void {
    const rec = this.keys.get(keyId);
    if (!rec) return;
    this.inUseKeyIds.delete(keyId);
    const fp = secretFingerprint(rec.provider, rec.secret);
    if (fp) this.inUseSecrets.delete(fp);
    if (rec.status === "in_use") {
      rec.status = rec.cooldownUntilMs > Date.now() ? "cooldown" : "available";
    }
  }

  private drainWaiters(provider: LlmProvider): void {
    const q = this.waiters.get(provider);
    if (!q?.length) return;
    while (q.length > 0) {
      const handle = this.tryCheckoutNow(provider, q[0]!.opts);
      if (!handle) break;
      const waiter = q.shift()!;
      clearTimeout(waiter.timeoutId);
      waiter.resolve(handle);
    }
  }

  private removeWaiter(provider: LlmProvider, target: Waiter): void {
    const q = this.waiters.get(provider);
    if (!q) return;
    const idx = q.indexOf(target);
    if (idx >= 0) q.splice(idx, 1);
  }
}
