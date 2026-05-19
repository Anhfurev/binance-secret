import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,

    sendDefaultPii: true,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    // Do not set includeLocalVariables: true in production — Sentry opens
    // node:inspector (prints "Debugger listening on ws://127.0.0.1…") and hurts perf.
  });
}
