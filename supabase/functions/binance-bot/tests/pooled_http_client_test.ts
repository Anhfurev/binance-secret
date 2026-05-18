import { assertEquals } from "jsr:@std/assert";
import {
  prewarmPooledHttpHost,
  readPooledHttpClientCount,
} from "../pooled-http-client.ts";

Deno.test("pooled http client caches Deno.HttpClient per host", () => {
  const before = readPooledHttpClientCount();
  prewarmPooledHttpHost("api.binance.com");
  prewarmPooledHttpHost("api.binance.com");
  assertEquals(readPooledHttpClientCount(), before);
});
