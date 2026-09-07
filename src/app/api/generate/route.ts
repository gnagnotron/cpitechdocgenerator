import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { generateFromZipBuffer } from "@/lib/pipeline/generate";
import { createZipBuffer } from "@/lib/parsers/zip";
import { createSessionId, saveSession } from "@/lib/session-store";

export const runtime = "nodejs";

const archiveFolderName = (fileName: string, index: number) => {
  const baseName = fileName
    .replace(/\.zip$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || `iflow-${index + 1}`;
  return `${String(index + 1).padStart(2, "0")}-${baseName}`;
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");
    const legacyFile = formData.get("file");
    const language = formData.get("language");
    const uploadedFiles = (files.length > 0 ? files : [legacyFile]).filter(
      (file): file is File => file instanceof File,
    );

    if (uploadedFiles.length === 0) {
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

    const invalidFile = uploadedFiles.find(
      (file) => !file.name.toLowerCase().endsWith(".zip"),
    );
    if (invalidFile) {
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

    const results = [];
    const allFiles: Array<{ fileName: string; content: string }> = [];

    for (const [index, file] of uploadedFiles.entries()) {
      const zipBuffer = Buffer.from(await file.arrayBuffer());
      const sessionId = createSessionId();
      const result = await generateFromZipBuffer(zipBuffer, {
        language: typeof language === "string" ? (language as "it" | "en" | "fr" | "de") : undefined,
        sourceFileName: file.name,
        sessionId,
      });
      const folder = archiveFolderName(file.name, index);

      allFiles.push(
        {
          fileName: `${folder}/canonical-model.json`,
          content: JSON.stringify(result.canonicalModel, null, 2),
        },
        {
          fileName: `${folder}/flow-graph.json`,
          content: JSON.stringify(result.flowGraph, null, 2),
        },
        {
          fileName: `${folder}/quality-gate-report.json`,
          content: JSON.stringify(result.qualityGate, null, 2),
        },
        ...result.documents.flatMap((doc) => [
          { fileName: `${folder}/${doc.name}.md`, content: doc.markdown },
          { fileName: `${folder}/${doc.name}.html`, content: doc.html },
        ]),
      );

      await saveSession({
        id: sessionId,
        createdAt: new Date().toISOString(),
        fileName: file.name,
        language: result.locale,
        mode: result.mode,
        templateIds: result.selectedTemplateIds,
        aiUsed: false,
        sharePath: `/?session=${sessionId}`,
        warnings: result.warnings,
        canonicalModel: result.canonicalModel,
        flowGraph: result.flowGraph,
        qualityGate: result.qualityGate,
        documents: result.documents,
      });
      results.push({ fileName: file.name, sessionId, sharePath: `/?session=${sessionId}`, result });
    }

    const first = results[0].result;
    const documents = results.flatMap(({ fileName, result }, index) =>
      result.documents.map((document) => ({
        ...document,
        name: `${archiveFolderName(fileName, index)}-${document.name}`,
        displayName: `${fileName}: ${document.displayName ?? document.name}`,
      })),
    );
    const warnings = results.flatMap(({ fileName, result }) =>
      result.warnings.map((warning) => ({
        ...warning,
        path: warning.path ? `${fileName}: ${warning.path}` : fileName,
      })),
    );
    const outputZip = createZipBuffer([
      ...allFiles,
      {
        fileName: "batch-report.json",
        content: JSON.stringify(
          results.map(({ fileName, sessionId, sharePath, result }) => ({
            fileName,
            sessionId,
            sharePath,
            warnings: result.warnings,
            qualityGate: result.qualityGate,
          })),
          null,
          2,
        ),
      },
    ]);

    return NextResponse.json({
      sessionId: results[0].sessionId,
      sharePath: results[0].sharePath,
      warnings,
      canonicalModel: first.canonicalModel,
      flowGraph: first.flowGraph,
      qualityGate: first.qualityGate,
      locale: first.locale,
      mode: first.mode,
      selectedTemplateIds: first.selectedTemplateIds,
      documents,
      bundleBase64: outputZip.toString("base64"),
      results: results.map(({ fileName, sessionId, sharePath, result }) => ({
        fileName,
        sessionId,
        sharePath,
        warnings: result.warnings,
        qualityGate: result.qualityGate,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
