import { assertEquals } from "jsr:@std/assert";
import { parsePublicBookTickerResponse } from "../public-ticker.ts";

Deno.test("parsePublicBookTickerResponse derives mid from bid and ask", () => {
  const parsed = parsePublicBookTickerResponse({
    bidPrice: "99",
    askPrice: "101",
  });
  assertEquals(parsed, { bid: 99, ask: 101, last: 100 });
});
