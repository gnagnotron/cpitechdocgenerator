import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { generateFromZipBuffer } from "@/lib/pipeline/generate";
import { createZipBuffer } from "@/lib/parsers/zip";
import { createSessionId, saveSession } from "@/lib/session-store";
import type { PublicGenerateRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PublicGenerateRequest;
    if (!body?.zipBase64) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_ZIP_BASE64",
            message: "zipBase64 is required.",
            suggestion: "Provide a base64 encoded SAP iFlow ZIP.",
          },
        },
        { status: 400 },
      );
    }

    const sessionId = createSessionId();
    const zipBuffer = Buffer.from(body.zipBase64, "base64");
    const result = await generateFromZipBuffer(zipBuffer, {
      language: body.language,
      templateIds: body.templateIds,
      mode: body.mode,
      sessionId,
      sourceFileName: "api-upload.zip",
    });

    const outputZip = createZipBuffer([
      { fileName: "canonical-model.json", content: JSON.stringify(result.canonicalModel, null, 2) },
      { fileName: "flow-graph.json", content: JSON.stringify(result.flowGraph, null, 2) },
      { fileName: "quality-gate-report.json", content: JSON.stringify(result.qualityGate, null, 2) },
      ...result.documents.flatMap((doc) => [
        { fileName: `${doc.name}.md`, content: doc.markdown },
        { fileName: `${doc.name}.html`, content: doc.html },
      ]),
    ]);

    await saveSession({
      id: sessionId,
      createdAt: new Date().toISOString(),
      fileName: "api-upload.zip",
      language: result.locale,
      mode: result.mode,
      templateIds: result.selectedTemplateIds,
      aiUsed: result.aiReport.enabled,
      sharePath: `/?session=${sessionId}`,
      warnings: result.warnings,
      canonicalModel: result.canonicalModel,
      flowGraph: result.flowGraph,
      qualityGate: result.qualityGate,
      documents: result.documents,
    });

    return NextResponse.json({
      sessionId,
      sharePath: `/?session=${sessionId}`,
      warnings: result.warnings,
      canonicalModel: result.canonicalModel,
      flowGraph: result.flowGraph,
      qualityGate: result.qualityGate,
      locale: result.locale,
      mode: result.mode,
      selectedTemplateIds: result.selectedTemplateIds,
      aiReport: result.aiReport,
      documents: result.documents,
      bundleBase64: outputZip.toString("base64"),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
