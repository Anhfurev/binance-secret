import { assertEquals } from "jsr:@std/assert";
import {
  classifyLlmKeyReleaseOutcome,
  isLlmBlockedHttpFailure,
  isLlmClientPayloadHttpFailure,
  isLlmRateLimitHttpFailure,
} from "../llm-key-failure-classify.ts";
import { LlmHttpError } from "../llm-http-error.ts";
import {
  clearLlmBatchKeyRegistry,
  listBatchBlockedDbIds,
  listBatchFailedDbIds,
  registerLlmKeyFailureFromError,
} from "../llm-inflight-key-registry.ts";

const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

Deno.test("classify: 408/abort is error not rate_limit", () => {
  assertEquals(
    classifyLlmKeyReleaseOutcome(new LlmHttpError("timeout", 408, "")),
    "error",
  );
  assertEquals(
    classifyLlmKeyReleaseOutcome(new Error("LLM_HARD_TIMEOUT abort")),
    "error",
  );
  assertEquals(isLlmRateLimitHttpFailure(new LlmHttpError("rl", 429, "")), true);
});

Deno.test("classify: 400 INVALID_ARGUMENT is client_error not rate_limit", () => {
  const err = new LlmHttpError(
    "INVALID_ARGUMENT: Cached content is too small",
    400,
    "total_token_count=118 min_total_token_count=2048",
  );
  assertEquals(classifyLlmKeyReleaseOutcome(err), "client_error");
  assertEquals(isLlmClientPayloadHttpFailure(err), true);
  assertEquals(isLlmRateLimitHttpFailure(err), false);
  assertEquals(isLlmBlockedHttpFailure(err), false);
});

Deno.test("classify: 403 blocked not rate_limit", () => {
  const err = new LlmHttpError("forbidden", 403, "");
  assertEquals(classifyLlmKeyReleaseOutcome(err), "blocked");
  assertEquals(isLlmBlockedHttpFailure(err), true);
  assertEquals(isLlmRateLimitHttpFailure(err), false);
});

Deno.test("registry flush lists only db lock ids", () => {
  clearLlmBatchKeyRegistry();
  const uuidBlocked = "b2b3c4d5-e6f7-8901-bcde-f12345678901";
  const lock429 = `groq:secret:groq-key`;
  const lock403 = `gemini:secret:gem-key`;
  registerLlmKeyFailureFromError(lock429, new LlmHttpError("rl", 429, ""), UUID);
  registerLlmKeyFailureFromError(lock403, new LlmHttpError("dead", 403, ""), uuidBlocked);
  assertEquals(listBatchFailedDbIds(), [UUID]);
  assertEquals(listBatchBlockedDbIds(), [uuidBlocked]);
});

Deno.test("registry ignores message-only quota without HTTP 429", () => {
  clearLlmBatchKeyRegistry();
  const lockId = `gemini:secret:fake-key`;
  registerLlmKeyFailureFromError(lockId, new Error("QUOTA_EXHAUSTED text only"));
  assertEquals(listBatchFailedDbIds().length, 0);
});
