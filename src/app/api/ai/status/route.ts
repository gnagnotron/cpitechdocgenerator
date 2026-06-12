import { NextResponse } from "next/server";
import { getAIConfigurationStatus } from "@/lib/ai-enhancer";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getAIConfigurationStatus();
  return NextResponse.json(status);
}
