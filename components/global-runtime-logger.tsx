"use client";

import { useEffect } from "react";
import { formatUnknownError } from "@/lib/error-utils";

export function GlobalRuntimeLogger() {
  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      console.error("[GlobalRuntimeLogger][window.error]", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = formatUnknownError(event.reason);
      console.error("[GlobalRuntimeLogger][unhandledrejection]", {
        reason,
        raw: event.reason,
      });
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}

