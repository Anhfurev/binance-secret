import { NextRequest, NextResponse } from "next/server";
import { runLearningMode } from "@/lib/learning-mode";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runLearningMode();

  return NextResponse.json({
    ...result,
    ranAt: new Date().toISOString(),
  });
}