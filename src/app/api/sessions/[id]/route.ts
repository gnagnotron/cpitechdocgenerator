import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { loadSession } from "@/lib/session-store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await loadSession(id);

    if (!session) {
      throw new AppError("SESSION_NOT_FOUND", "Sessione non trovata.", 404, "Verifica il link pubblico o rigenera la documentazione.");
    }

    return NextResponse.json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
