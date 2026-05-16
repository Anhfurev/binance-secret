import * as Sentry from "@sentry/nextjs";
import { reportNextDebuggerTelegram } from "./lib/debugger-telegram-server";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

type CaptureRequestError = typeof Sentry.captureRequestError;

export const onRequestError: CaptureRequestError = async (...args: Parameters<CaptureRequestError>) => {
  Sentry.captureRequestError(...args);
  try {
    const [error, request, errorContext] = args;
    const message = error instanceof Error ? error.message : String(error);
    const digest =
      error && typeof error === "object" && "digest" in error
        ? String((error as { digest?: string }).digest ?? "")
        : "";
    const path = request?.path ?? "";
    const routePath = errorContext?.routePath ?? "";
    const routeType = errorContext?.routeType ?? "";
    await reportNextDebuggerTelegram({
      scope: `next_onRequestError|${routeType || "?"}`,
      path: path || routePath,
      detail: `${message}${digest ? ` (digest:${digest})` : ""}`.slice(0, 1200),
    });
  } catch {
    // never break the instrumentation hook
  }
};
