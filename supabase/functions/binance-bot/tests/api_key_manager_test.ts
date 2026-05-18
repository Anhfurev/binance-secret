import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  APIKeyCheckoutTimeoutError,
  APIKeyManager,
} from "../api-key-manager.ts";

function buildPool(n: number, provider: "gemini" | "groq" = "gemini") {
  const mgr = new APIKeyManager();
  mgr.registerKeys(
    Array.from({ length: n }, (_, i) => ({
      id: `${provider}:${i}`,
      provider,
      secret: `secret-${i}`,
    })),
  );
  return mgr;
}

Deno.test("APIKeyManager: parallel checkout gets distinct keys", async () => {
  const mgr = buildPool(3);
  const [a, b, c] = await Promise.all([
    mgr.checkoutKey("gemini"),
    mgr.checkoutKey("gemini"),
    mgr.checkoutKey("gemini"),
  ]);
  const ids = new Set([a.keyId, b.keyId, c.keyId]);
  assertEquals(ids.size, 3);
  mgr.checkinKey(a.keyId);
  mgr.checkinKey(b.keyId);
  mgr.checkinKey(c.keyId);
});

Deno.test("APIKeyManager: checkout waits until checkin", async () => {
  const mgr = buildPool(1);
  const first = await mgr.checkoutKey("gemini");
  let secondId = "";
  const pending = mgr.checkoutKey("gemini", { timeoutMs: 500 }).then((h) => {
    secondId = h.keyId;
  });
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(secondId, "");
  mgr.checkinKey(first.keyId);
  await pending;
  assertEquals(secondId, first.keyId);
});

Deno.test("APIKeyManager: checkout timeout when pool exhausted", async () => {
  const mgr = buildPool(1);
  await mgr.checkoutKey("gemini");
  await assertRejects(
    () => mgr.checkoutKey("gemini", { timeoutMs: 80 }),
    APIKeyCheckoutTimeoutError,
  );
});

Deno.test("APIKeyManager: cooldown skips key until expired", async () => {
  const mgr = buildPool(2);
  const k0 = await mgr.checkoutKey("gemini");
  mgr.markCooldown(k0.keyId, 0.001, "429");
  mgr.checkinKey(k0.keyId);
  const next = await mgr.checkoutKey("gemini");
  assertEquals(next.keyId !== k0.keyId, true);
});

Deno.test("APIKeyManager: duplicate secrets share one inflight slot", async () => {
  const mgr = new APIKeyManager();
  mgr.registerKeys([
    { id: "a", provider: "gemini", secret: "same" },
    { id: "b", provider: "gemini", secret: "same" },
  ]);
  const first = await mgr.checkoutKey("gemini");
  let secondResolved = false;
  const pending = mgr.checkoutKey("gemini", { timeoutMs: 100 }).then(() => {
    secondResolved = true;
  });
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(secondResolved, false);
  mgr.checkinKey(first.keyId);
  await pending;
  assertEquals(secondResolved, true);
});

Deno.test("APIKeyManager: lane offset spreads preferred picks", async () => {
  const mgr = buildPool(4);
  mgr.bumpLaneOffset();
  const a = await mgr.checkoutKey("gemini");
  mgr.checkinKey(a.keyId);
  mgr.bumpLaneOffset();
  const b = await mgr.checkoutKey("gemini");
  assertEquals(a.keyId !== b.keyId, true);
});

Deno.test("APIKeyManager: isHydrated false when no keys registered", () => {
  const empty = new APIKeyManager();
  assertEquals(empty.isHydrated(), false);
  assertEquals(empty.registeredKeyCount(), 0);
  assertEquals(empty.countEligibleKeys(), 0);

  const skipped = new APIKeyManager();
  skipped.registerKeys([
    { id: "gemini:0", provider: "gemini", secret: "   " },
  ]);
  assertEquals(skipped.registeredKeyCount(), 0);
  assertEquals(skipped.isHydrated(), false);
});
