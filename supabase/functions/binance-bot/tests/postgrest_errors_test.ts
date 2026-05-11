import {
  extractPostgrestErrorCode,
  isTransientPostgrestError,
} from "../postgrest-errors.ts";
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("extractPostgrestErrorCode reads PostgrestError code", () => {
  assertEquals(extractPostgrestErrorCode({ code: "PGRST002", message: "x" }), "PGRST002");
  assertEquals(extractPostgrestErrorCode(new Error("plain")), null);
});

Deno.test("isTransientPostgrestError matches schema cache outages", () => {
  assertEquals(
    isTransientPostgrestError({
      code: "PGRST002",
      message: "Could not query the database for the schema cache. Retrying.",
    }),
    true,
  );
  assertEquals(isTransientPostgrestError(new Error("null value in column price")), false);
});
