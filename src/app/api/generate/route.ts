import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { generateFromZipBuffer } from "@/lib/pipeline/generate";
import { createZipBuffer } from "@/lib/parsers/zip";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_FILE",
            message: "Nessun file caricato.",
            suggestion: "Carica un file .zip di SAP iFlow.",
          },
        },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FILE_TYPE",
            message: "Formato file non supportato.",
            suggestion: "Carica un file con estensione .zip.",
          },
        },
        { status: 400 },
      );
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const result = generateFromZipBuffer(zipBuffer);

    const allFiles: Array<{ fileName: string; content: string }> = [
      {
        fileName: "canonical-model.json",
        content: JSON.stringify(result.canonicalModel, null, 2),
      },
      {
        fileName: "flow-graph.json",
        content: JSON.stringify(result.flowGraph, null, 2),
      },
      {
        fileName: "quality-gate-report.json",
        content: JSON.stringify(result.qualityGate, null, 2),
      },
      ...result.documents.flatMap((doc) => [
        { fileName: `${doc.name}.md`, content: doc.markdown },
        { fileName: `${doc.name}.html`, content: doc.html },
      ]),
    ];

    const outputZip = createZipBuffer(allFiles);

    return NextResponse.json({
      warnings: result.warnings,
      canonicalModel: result.canonicalModel,
      flowGraph: result.flowGraph,
      qualityGate: result.qualityGate,
      documents: result.documents,
      bundleBase64: outputZip.toString("base64"),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
