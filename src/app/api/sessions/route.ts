import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { listSessions } from "@/lib/session-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
